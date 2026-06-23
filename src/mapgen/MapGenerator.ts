import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import { Vec3 } from "../common/3DMath";
import type { GlobeMap, MeshCell } from "../common/map";
import { makeRNG } from "../common/random";
import {
  INVARIANTS,
  MESH,
  SLIDER_RANGES,
  type MapSettings,
  type TerrainParams,
} from "../common/settings";
import { applyContrast, clamp, lerp, smoothstep } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import { fbm3 } from "./fbm";
import {
  goldbergCapLevel,
  goldbergCapMesh,
  goldbergLevelForPoints,
  goldbergMesh,
} from "./Goldberg";

// Phase offset so the ice-edge ruffle noise doesn't line up with the elevation field.
const ICE_RUFFLE_OFFSET = 53.1;
// Base scale of the ice-edge wobble (a finer octave at 3× rides on top).
const ICE_RUFFLE_FREQ = 4.2;
// Ice FILL is patchiness from a fixed-wavelength noise (NOT elevation) — so holes / nunataks are
// independent of where mountains sit (plates can't shape the cap) and stay put across zoom. FREQ
// sets hole size (bigger = smaller holes); SOFTNESS the hole-edge softness.
const ICE_HOLE_FREQ = 10;
const ICE_HOLE_SOFTNESS = 0.15;
// Phase offset decorrelating the moisture noise from the elevation field (any value works; not a dial).
const MOISTURE_NOISE_OFFSET = 25;

// The whole-globe rung meshes the entire sphere, so it ignores its centre; this stand-in
// documents that the value is irrelevant (any unit vector works).
const WHOLE_GLOBE_CENTER: Vec3 = { x: 0, y: 0, z: 1 };

// Per-seed dials shared by the global mesh and every local patch, so a zoomed-in
// patch lines up exactly with the same continents/biomes (just finer).
type Flavor = {
  coastWavelength: number;
  peakWavelength: number;
  moistureWavelength: number;
  oceanWavelength: number;
  rainfall: number;
  iceCoverage: number;
};

/** Total globe points for a resolution (zoom does not change generation). */
export function globePointCount(resolution: number): number {
  return Math.round(
    lerp(SLIDER_RANGES.POINT_COUNT[0], SLIDER_RANGES.POINT_COUNT[1], resolution)
  );
}

/**
 * Generates a planet's terrain. The global hex mesh depends only on point count, so it's cached
 * and reused across seeds — only per-cell fields recompute. The globe and every zoomed-in patch
 * are ONE family of LOD rungs built by `generate`: the globe is the coarsest (whole-sphere mesh);
 * finer rungs mesh just the visible cap at higher density and layer extra MOUNTAIN octaves (finer
 * surface detail, same continents/coastline/biomes). Rotation never regenerates (the renderer
 * re-projects); sea level + theme are render-time.
 *
 * Every tuned value comes from an injected `params` snapshot (TerrainParams), not the live global
 * dials — so a generator is a pure function of (seed, params). `configure` re-points it at a new
 * seed and/or params; the main thread resolves params and hands them across the worker seam.
 */
export class MapGenerator {
  private params: TerrainParams;
  private noise3D: NoiseFunction3D;
  private elevationCalc: ElevationCalculator;
  private meshCache = new Map<number, MeshCell[]>();
  // Plate-motion arrows for the "view plates" overlay — seed-level, so sampled once and reused by
  // every rung (cleared on configure). null until first needed.
  private arrowData: { positions: Float32Array; directions: Float32Array } | null = null;
  // Harness hook (the /sweep page): when non-null, forces continentalness to this constant so the
  // base is a flat inland plain and ONLY MOUNTAIN/TECTONIC vary. null = normal terrain.
  public flatBaseC: number | null = null;

  public constructor(seed: string, params: TerrainParams) {
    this.params = params;
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.noise3D, seed, params);
  }

  /**
   * Re-point the generator at a new seed and/or params, rebuilding the noise field + per-seed
   * tectonics. The mesh cache is KEPT — the hex mesh is pure geometry per level, independent of
   * both seed and params. Replaces the old reSeed + tune(applyTuning) dance: params arrive already
   * resolved on the main thread, so the worker no longer re-samples dials in its own realm.
   */
  public configure(seed: string, params: TerrainParams) {
    this.params = params;
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.noise3D, seed, params);
    this.arrowData = null; // plates change with the seed/params → resample on next use
  }

  /** Re-seed while keeping the current params — a thin wrapper over `configure`. */
  public reSeed(seed: string) {
    this.configure(seed, this.params);
  }

  /**
   * Generate ONE level-of-detail rung — the globe and every zoom-in patch are the same family, so
   * they share this single path (no global/local special case). `halfAngle >= π` means the WHOLE
   * GLOBE (the coarsest rung): the full nested hex mesh (cached by level, reused across seeds),
   * packed with NO extra octaves and no occlusion cap. A smaller `halfAngle` is a detail cap around
   * `center`: a finer hex tiling nested in the global mesh, with `extraOctaves` of MOUNTAIN detail
   * layered on. Only that additive mountain relief gains octaves on zoom — the coast/ocean waves
   * (see ElevationCalculator) and the moisture wave (see moistureAt) keep fixed octaves, so neither
   * the coastline nor the biome boundaries move as you zoom.
   *
   * The once-per-seed work — the noise field and the tectonic plates — lives in the constructor /
   * configure and is SHARED by every rung. Nothing globe-wide is (re)built here, so rung 0 is exactly
   * "coarse mesh + per-cell fields," no heavier than any other rung.
   */
  public generate(
    center: Vec3,
    halfAngle: number,
    points: number,
    extraOctaves: number
  ): GlobeMap {
    const flavor = this.sampleFlavor();
    // Whole globe: the full mesh (cached by level), 0 extra octaves. The globe is the zoom-0
    // reference every patch refines, so it must never carry patch-only detail — extraOctaves is
    // forced to 0 here regardless of what's passed.
    if (halfAngle >= Math.PI) {
      const mesh = this.getMesh(points);
      return this.packMesh(mesh, flavor, 0, points);
    }
    // Detail cap at a finer subdivision than the global mesh; its hexes nest inside the global
    // ones (same icosahedron), so it refines IN PLACE rather than re-tessellating — stable as you
    // zoom. `points` (the rung density) picks the level. Cells outside the inset cap, and
    // incomplete-ring boundary cells, are dropped inside.
    const keepHalfAngle = halfAngle * MESH.LOCAL_KEEP_FRACTION;
    const mesh = goldbergCapMesh(center, keepHalfAngle, goldbergCapLevel(points));
    // Cap (inset) the renderer uses to skip global base cells hidden by this patch.
    const cap = {
      center,
      cosKeep: Math.cos(
        Math.max(0, keepHalfAngle - (MESH.OCCLUSION_MARGIN_DEG * Math.PI) / 180)
      ),
    };
    return this.packMesh(mesh, flavor, extraOctaves, mesh.length, cap);
  }

  /** Whole-globe map at a resolution's point count — thin adapter over `generate` for the /sweep +
   *  /explorer dev harnesses (the live app drives `generate` straight from the worker). */
  public generateMap(input: MapSettings): GlobeMap {
    return this.generate(WHOLE_GLOBE_CENTER, Math.PI, globePointCount(input.resolution), 0);
  }

  /** Dense cap map around `center` — thin adapter over `generate` for the dev harnesses. */
  public generateLocalMap(
    center: Vec3,
    halfAngle: number,
    points: number,
    extraOctaves: number
  ): GlobeMap {
    return this.generate(center, halfAngle, points, extraOctaves);
  }

  /** Per-seed flavor dials (relief/moisture wavelengths, rainfall, ice caps). */
  private sampleFlavor(): Flavor {
    const { COAST, MOUNTAIN, MOISTURE, OCEAN, ICE } = this.params;
    const coastWavelength = COAST.WAVELENGTH;
    const peakWavelength = MOUNTAIN.RIDGE_WAVELENGTH;
    const moistureWavelength = MOISTURE.WAVELENGTH;
    const rainfall = MOISTURE.RAINFALL;
    const oceanWavelength = OCEAN.WAVELENGTH;
    return {
      coastWavelength,
      peakWavelength,
      moistureWavelength,
      oceanWavelength,
      rainfall,
      iceCoverage: clamp(ICE.COVERAGE),
    };
  }

  /**
   * Pack a mesh (sites + rings) and its computed fields into the flat typed-array
   * GlobeMap in a single pass: copy geometry into shared buffers and sample
   * elevation/moisture/ice per cell.
   */
  private packMesh(
    cells: MeshCell[],
    flavor: Flavor,
    extraOctaves: number,
    pointCount: number,
    cap?: { center: Vec3; cosKeep: number }
  ): GlobeMap {
    const n = cells.length;
    let totalVerts = 0;
    for (let i = 0; i < n; i++) totalVerts += cells[i].ring.length;

    const sites = new Float32Array(n * 3);
    const ringOffsets = new Uint32Array(n + 1);
    const ringVerts = new Float32Array(totalVerts * 3);
    const elevation = new Float32Array(n);
    const moisture = new Float32Array(n);
    const ice = new Float32Array(n);
    const shade = new Float32Array(n);
    const plate = new Uint16Array(n);

    let vo = 0;
    let maxChord2 = 0; // largest squared site→ring-vert distance (cull radius)
    for (let i = 0; i < n; i++) {
      const { site, ring } = cells[i];
      sites[3 * i] = site.x;
      sites[3 * i + 1] = site.y;
      sites[3 * i + 2] = site.z;
      ringOffsets[i] = vo;
      for (let k = 0; k < ring.length; k++) {
        const rx = ring[k].x;
        const ry = ring[k].y;
        const rz = ring[k].z;
        ringVerts[3 * vo] = rx;
        ringVerts[3 * vo + 1] = ry;
        ringVerts[3 * vo + 2] = rz;
        const dx = rx - site.x;
        const dy = ry - site.y;
        const dz = rz - site.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxChord2) maxChord2 = d2;
        vo++;
      }
      const cell = this.computeCellProperties(site, flavor, extraOctaves);
      elevation[i] = cell.elevation;
      moisture[i] = cell.moisture;
      ice[i] = cell.ice;
      shade[i] = cell.shade;
      plate[i] = this.elevationCalc.plateAt(site);
    }
    ringOffsets[n] = vo;

    // Plate-motion arrows are seed-level (identical for every rung): sample once, memoize, and let
    // every map reference the cached arrays — postMessage structured-clones them, so the cache (and
    // thus the same-thread dev harnesses) keep valid buffers.
    if (!this.arrowData) this.arrowData = this.elevationCalc.boundaryArrows();

    return {
      cellCount: n,
      sites,
      ringOffsets,
      ringVerts,
      elevation,
      moisture,
      ice,
      shade,
      plate,
      arrowPositions: this.arrowData.positions,
      arrowDirections: this.arrowData.directions,
      rainfall: flavor.rainfall,
      pointCount,
      maxRingRadius: Math.sqrt(maxChord2),
      cap,
    };
  }

  /**
   * The full per-cell field pipeline in one place: sample the shared continentalness
   * once (expensive noise lookups, reused across fields), then derive elevation,
   * moisture, and ice from it.
   */
  private computeCellProperties(
    site: Vec3,
    flavor: Flavor,
    extraOctaves: number
  ): { elevation: number; moisture: number; ice: number; shade: number } {
    // continentalness drives both the land/ocean elevation and the moisture maritime layer
    // (`broad` = the low-octave low-pass that sizes the maritime reach to the water body).
    const { full: continentalness, broad: broadContinentalness } =
      this.flatBaseC !== null
        ? { full: this.flatBaseC, broad: this.flatBaseC }
        : this.elevationCalc.continentalness(
            site.x,
            site.y,
            site.z,
            this.params.MOISTURE.WATER_SIZE_OCTAVES
          );
    const reliefCfg = {
      coastWavelength: flavor.coastWavelength,
      peakWavelength: flavor.peakWavelength,
      oceanWavelength: flavor.oceanWavelength,
      extraOctaves,
    };
    const elevation = this.elevationCalc.elevationAt(
      site,
      reliefCfg,
      continentalness
    );
    // Relief shading from the SAME field — reuses continentalness, only re-samples the relief
    // twice (for the slope). Baked per cell → a free colour multiply at draw time.
    const shade = this.elevationCalc.hillshadeAt(
      site,
      reliefCfg,
      continentalness,
      elevation
    );
    const moisture = this.moistureAt(
      site,
      flavor.moistureWavelength,
      continentalness,
      broadContinentalness
    );
    const ice = this.iceAt(site, elevation, flavor.iceCoverage);
    return { elevation, moisture, ice, shade };
  }

  /** Build (or reuse) the global hex (Goldberg) mesh for a point count. The point count
   *  picks a subdivision level; the grid is deterministic + nested, so it's stable across
   *  zoom (a finer level refines the coarse hexes in place rather than re-tessellating). */
  private getMesh(pointCount: number): MeshCell[] {
    const level = goldbergLevelForPoints(pointCount);
    const cached = this.meshCache.get(level);
    if (cached) return cached;

    const mesh = goldbergMesh(level);
    this.meshCache.set(level, mesh);
    while (this.meshCache.size > MESH.CACHE_CAP) {
      const oldest = this.meshCache.keys().next().value;
      if (oldest === undefined) break;
      this.meshCache.delete(oldest);
    }
    return mesh;
  }

  /**
   * Moisture in [0,1] at a sphere point; contrast baked in (it's a fixed dial). Like the COAST /
   * OCEAN waves (see ElevationCalculator), this wave uses its OWN fixed octave count — never the
   * zoom `extraOctaves`. Moisture decides the discrete biome bands (the wet/dry colour + the
   * elevation×moisture blend), so freezing its octaves keeps the CLIMATE map identical at every
   * zoom: zooming in resolves the SAME biome boundaries with a finer mesh instead of growing new
   * octaves that crawl them around (the coastline fix, one field over). Want a more detailed
   * climate? Raise MOISTURE.OCTAVES — it applies to the globe and every patch uniformly.
   */
  private moistureAt(
    site: Vec3,
    moistureWavelength: number,
    continentalness: number,
    broadContinentalness: number
  ): number {
    const { MOISTURE, features } = this.params;
    if (!features.climate) return INVARIANTS.NEUTRAL_CENTER_POINT; // climate off → flat moisture everywhere
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE_NOISE_OFFSET,
      site.y + MOISTURE_NOISE_OFFSET,
      site.z + MOISTURE_NOISE_OFFSET,
      moistureWavelength,
      MOISTURE.AMPLITUDE,
      MOISTURE.OCTAVES, // fixed (NOT + extraOctaves) so biome boundaries don't crawl as you zoom
      MOISTURE.GAIN,
      MOISTURE.LACUNARITY
    );
    let m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw);
    // Maritime humidity: pull moisture toward wet near water, up to WATER_PROXIMITY_EFFECT
    // (0 = off), falling from the coast toward the interior at DESERT_STEEPNESS (>1 = deserts
    // ramp in fast near the coast). Reach scales with water-body SIZE via min(full, broad):
    // a big ocean keeps `broad` low far inland (wide effect); an oasis only dents the sharp
    // local field (broad ignores it → min falls back to `full` → thin coastal strip).
    const oceanic = Math.min(continentalness, broadContinentalness);
    const waterProximity = Math.pow(1 - oceanic, MOISTURE.DESERT_STEEPNESS);
    m = lerp(m, 1, MOISTURE.WATER_PROXIMITY_EFFECT * waterProximity);
    return applyContrast(m, MOISTURE.CONTRAST);
  }

  /**
   * Polar iciness in [0,1] — LAND ONLY (open water never ices), blended into the terrain
   * downstream. A cap sits poleward of a snow line set by COVERAGE; the line is wobbled by noise
   * (WOBBLE) so it isn't a clean circle, fades into the land over BLEND, and low-lying land pokes
   * through as holes below a FILL-controlled elevation threshold (higher FILL → fewer holes).
   */
  private iceAt(site: Vec3, elevation: number, coverage: number): number {
    const { ICE, OCEAN, features } = this.params;
    if (!features.ice) return 0; // ice layer off → no polar caps anywhere
    // Snow line in |sin lat|: COVERAGE is the fraction of each hemisphere the cap reaches, so the
    // line sits at 1 − COVERAGE (higher COVERAGE → line nearer the equator → bigger caps).
    const line = 1 - coverage;
    // Wobble the line: a base wave (lopsided outline) + a finer octave at 3× (ragged edge), so the
    // cap isn't a clean circle. Only the edge moves; the interior stays solid.
    const f = ICE_RUFFLE_FREQ;
    const o = ICE_RUFFLE_OFFSET;
    const wobble =
      ICE.WOBBLE *
      (this.noise3D(site.x * f + o, site.y * f + o, site.z * f + o) +
        0.5 *
        this.noise3D(site.x * f * 3 + o, site.y * f * 3 + o, site.z * f * 3 + o));
    // Cap membership (both poles via |sin lat|), soft over BLEND on the equatorward side.
    const inCap = smoothstep(line - ICE.BLEND, line, Math.abs(site.y) + wobble);
    if (inCap <= 0) return 0;
    // LAND ONLY — ocean sits below the waterline, so it never ices. (Land elevation is clamped to
    // ≥ SEA_LEVEL upstream, so this drops only open water, NOT low-lying land — which now ices.)
    if (elevation < OCEAN.SEA_LEVEL) return 0;
    // FILL → holes from a fixed-wavelength noise (independent of mountains, so plates don't shape
    // the cap, and it's stable across zoom). FILL 1 = solid; lower opens patchy holes / nunataks.
    const h =
      0.5 +
      0.5 *
        this.noise3D(
          site.x * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET,
          site.y * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET,
          site.z * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET
        );
    const solid = smoothstep(1 - ICE.FILL, 1 - ICE.FILL + ICE_HOLE_SOFTNESS, h);
    return inCap * solid;
  }
}
