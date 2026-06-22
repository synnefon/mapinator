import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { GlobeMap, MeshCell } from "../common/map";
import { Vec3 } from "../common/3DMath";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  FEATURE_DETAIL_MID,
  FRACTAL,
  ICE,
  INVARIANTS,
  MESH,
  MOISTURE,
  MOUNTAIN,
  OCEAN,
  RAINFALL,
  SLIDER_RANGES,
  sampleDial,
  type MapSettings,
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

// Per-seed dials shared by the global mesh and every local patch, so a zoomed-in
// patch lines up exactly with the same continents/biomes (just finer).
type Flavor = {
  coastWavelength: number;
  mountainWavelength: number;
  moistureWavelength: number;
  oceanWavelength: number;
  rainfall: number;
  iceCapNorth: number;
  iceCapSouth: number;
};

/** Total globe points for a resolution (zoom does not change generation). */
export function globePointCount(resolution: number): number {
  return Math.round(
    lerp(SLIDER_RANGES.POINT_COUNT[0], SLIDER_RANGES.POINT_COUNT[1], resolution)
  );
}

/**
 * Generates a planet's terrain. The global Voronoi mesh depends only on point
 * count, so it's cached and reused across seeds — only per-cell fields recompute.
 * For zoomed-in views, `generateLocalMap` meshes just the visible cap at higher
 * density and layers extra fractal octaves (finer detail, same continents/biomes).
 * Rotation never regenerates (the renderer re-projects); sea level + theme are
 * render-time.
 */
export class MapGenerator {
  private noise3D: NoiseFunction3D;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;
  private seed: string;
  private meshCache = new Map<number, MeshCell[]>();

  public constructor(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise3D);
  }

  public reSeed(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise3D);
    // Mesh is seed-independent, so it stays cached across reSeed.
  }

  /** Whole-globe map at the resolution's point count (base octaves). */
  public generateMap(input: MapSettings): GlobeMap {
    const pointCount = globePointCount(input.resolution);
    const flavor = this.sampleFlavor();
    const mesh = this.getMesh(pointCount);
    const map = this.packMesh(mesh, flavor, 0, pointCount);
    return map;
  }

  /**
   * Dense map of just the visible cap (half-angle around `center`), built from the
   * subset of the global Fibonacci point set (`globalPoints`) that falls in the cap
   * — so cell SHAPES stay stable as you pan (overlapping views share points) rather
   * than re-tessellating. `extraOctaves` layers finer relief/moisture on top. Same
   * seed/dials as the global map, so it's the same world sampled finer.
   */
  public generateLocalMap(
    center: Vec3,
    halfAngle: number,
    globalPoints: number,
    extraOctaves: number
  ): GlobeMap {
    const flavor = this.sampleFlavor();
    // Hex cap at a finer subdivision than the global mesh; its hexes nest inside the global
    // ones (same icosahedron), so it refines detail IN PLACE rather than re-tessellating —
    // stable as you zoom. `globalPoints` (the rung density) picks the level. Cells outside
    // the inset cap, and incomplete-ring boundary cells, are dropped inside.
    const keepHalfAngle = halfAngle * MESH.LOCAL_KEEP_FRACTION;
    const mesh = goldbergCapMesh(center, keepHalfAngle, goldbergCapLevel(globalPoints));

    // Cap (inset) the renderer uses to skip global base cells hidden by this patch.
    const cap = {
      center,
      cosKeep: Math.cos(
        Math.max(0, keepHalfAngle - (MESH.OCCLUSION_MARGIN_DEG * Math.PI) / 180)
      ),
    };

    return this.packMesh(mesh, flavor, extraOctaves, mesh.length, cap);
  }

  /** Per-seed flavor dials (relief/moisture wavelengths, rainfall, ice caps). */
  private sampleFlavor(): Flavor {
    const flavorRng = makeRNG(this.seed + "-flavor");
    const coastWavelength = sampleDial(COAST.WAVELENGTH, flavorRng);
    const mountainWavelength = sampleDial(MOUNTAIN.WAVELENGTH, flavorRng);
    const moistureWavelength = sampleDial(MOISTURE.WAVELENGTH, flavorRng);
    const rainfall = sampleDial(RAINFALL, flavorRng);
    const oceanWavelength = sampleDial(OCEAN.WAVELENGTH, flavorRng);
    // One shared cap size, with a small per-pole tweak so the two aren't identical.
    const iceExtent = sampleDial(ICE.EXTENT, flavorRng);
    return {
      coastWavelength,
      mountainWavelength,
      moistureWavelength,
      oceanWavelength,
      rainfall,
      iceCapNorth: clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1),
      iceCapSouth: clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1),
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
    }
    ringOffsets[n] = vo;

    return {
      cellCount: n,
      sites,
      ringOffsets,
      ringVerts,
      elevation,
      moisture,
      ice,
      rainfall: flavor.rainfall,
      pointCount,
      maxRingRadius: Math.sqrt(maxChord2),
      cap,
    };
  }

  /**
   * The full per-cell field pipeline in one place: sample the shared erosion +
   * continentalness once (expensive noise lookups, reused across fields), then
   * derive elevation, moisture, and ice from them.
   */
  private computeCellProperties(
    site: Vec3,
    flavor: Flavor,
    extraOctaves: number
  ): { elevation: number; moisture: number; ice: number } {
    // erosion scales terrain relief AND modulates the moisture swing; continentalness
    // drives both the land/ocean elevation and the moisture maritime layer (`broad` =
    // the low-octave low-pass that sizes the maritime reach to the water body).
    const erosion = this.elevationCalc.erosionAmplitudeAt(site.x, site.y, site.z);
    const { full: continentalness, broad: broadContinentalness } =
      this.elevationCalc.continentalness(
        site.x,
        site.y,
        site.z,
        MOISTURE.WATER_SIZE_OCTAVES
      );
    const elevation = this.elevationCalc.elevationAt(
      site,
      {
        coastWavelength: flavor.coastWavelength,
        mountainWavelength: flavor.mountainWavelength,
        oceanWavelength: flavor.oceanWavelength,
        extraOctaves,
      },
      erosion,
      continentalness
    );
    const moisture = this.moistureAt(
      site,
      flavor.moistureWavelength,
      extraOctaves,
      erosion,
      continentalness,
      broadContinentalness
    );
    const ice = this.iceAt(site, elevation, flavor.iceCapNorth, flavor.iceCapSouth);
    return { elevation, moisture, ice };
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

  /** Moisture in [0,1] at a sphere point; contrast baked in (it's a fixed dial). */
  private moistureAt(
    site: Vec3,
    moistureWavelength: number,
    extraOctaves: number,
    erosion: number,
    continentalness: number,
    broadContinentalness: number
  ): number {
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE.NOISE_OFFSET,
      site.y + MOISTURE.NOISE_OFFSET,
      site.z + MOISTURE.NOISE_OFFSET,
      moistureWavelength,
      MOISTURE.AMPLITUDE,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    // Modulate the moisture swing by the same FEATURE_DETAIL field as terrain:
    // more wet/dry variation in rugged regions, smoother in calm ones.
    const detail = erosion / FEATURE_DETAIL_MID;
    let m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw * detail);
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
   * Polar iciness in [0,1], blended into the terrain downstream. Snow on LAND ONLY for
   * now (open water never ices). On land it's snow poleward of the snow line (the per-seed
   * cap minus LAND_BONUS), ramping down over EDGE on the equatorward side; the line is
   * ruffled by noise so the cap isn't a clean circle. Per pole (ASYMMETRY).
   */
  private iceAt(
    site: Vec3,
    elevation: number,
    capNorth: number,
    capSouth: number
  ): number {
    // Lower-lying land pokes through the ice (shows terrain) toward the equator, but that
    // fades out a little before each pole so the exact poles are solid: the land
    // threshold drops from LAND_THRESHOLD toward POLE_THRESHOLD (≈ sea level → all land
    // ices) as |y| approaches the pole.
    const solid = smoothstep(
      ICE.SOLID_LAT - ICE.SOLID_FADE,
      ICE.SOLID_LAT,
      Math.abs(site.y)
    );
    const landThreshold = lerp(ICE.LAND_THRESHOLD, ICE.POLE_THRESHOLD, solid);
    if (elevation <= landThreshold) return 0;
    // Ruffle the snow line: a base wave (slightly lopsided, asymmetrical outline) plus a
    // finer octave at 3× (ragged edge). Only the edge moves; the interior stays solid.
    const f = ICE.RUFFLE_FREQ;
    const o = ICE_RUFFLE_OFFSET;
    const ruffle =
      ICE.RUFFLE *
      (this.noise3D(site.x * f + o, site.y * f + o, site.z * f + o) +
        0.5 *
        this.noise3D(site.x * f * 3 + o, site.y * f * 3 + o, site.z * f * 3 + o));
    const lineN = capNorth - ICE.LAND_BONUS;
    const lineS = capSouth - ICE.LAND_BONUS;
    const north = smoothstep(lineN - ICE.EDGE, lineN, site.y + ruffle);
    const south = smoothstep(lineS - ICE.EDGE, lineS, -site.y + ruffle);
    return Math.max(north, south);
  }
}
