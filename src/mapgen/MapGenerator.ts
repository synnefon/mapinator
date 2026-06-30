import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import { Vec3 } from "../common/3DMath";
import type { GlobeMap, MeshCell } from "../common/map";
import { makeRNG } from "../common/random";
import {
  MESH,
  SLIDER_RANGES,
  type MapSettings,
  type TerrainParams,
} from "../common/settings";
import { lerp } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import {
  goldbergCapLevel,
  goldbergCapMesh,
  goldbergGlobeOverlayLevel,
  goldbergLevelForPoints,
  goldbergMesh,
} from "./Goldberg";

// The whole-globe rung meshes the entire sphere, so it ignores its centre; this stand-in
// documents that the value is irrelevant (any unit vector works).
const WHOLE_GLOBE_CENTER: Vec3 = { x: 0, y: 0, z: 1 };

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
 * finer rungs mesh just the visible cap at higher density (same continents/coastline/biomes).
 * Rotation never regenerates (the renderer re-projects); sea level + theme are render-time.
 *
 * The per-cell field model lives in ElevationCalculator.sampleCell — this class is just mesh build
 * + packing. Every tuned value comes from an injected `params` snapshot (TerrainParams), not the
 * live global dials, so a generator is a pure function of (seed, params). `configure` re-points it;
 * the main thread resolves params and hands them across the worker seam.
 */
export class MapGenerator {
  private params: TerrainParams;
  private noise3D: NoiseFunction3D;
  private elevationCalc: ElevationCalculator;
  private meshCache = new Map<number, MeshCell[]>();
  // Plate-motion arrows for the "tectonic plates" overlay — seed-level, so sampled once and reused by
  // every rung (cleared on configure). null until first needed.
  private arrowData: { positions: Float32Array; directions: Float32Array } | null = null;

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
   * Generate ONE level-of-detail rung — the globe and every zoom-in patch share this single path.
   * `halfAngle >= π` means the WHOLE GLOBE (the coarsest rung): the full nested hex mesh (cached by
   * level, reused across seeds). A smaller `halfAngle` is a detail cap around `center`: a finer hex
   * tiling nested in the global mesh (same icosahedron), so it refines IN PLACE rather than
   * re-tessellating — stable as you zoom. `continentalnessOverride` (the /sweep flat-base hook)
   * forces a flat inland base so ONLY MOUNTAIN/TECTONIC vary; undefined = normal terrain.
   */
  public generate(
    center: Vec3,
    halfAngle: number,
    points: number,
    continentalnessOverride?: number,
    geometryOnly = false
  ): GlobeMap {
    // Whole globe (the full mesh, cached by level). Two flavours, picked by geometryOnly:
    //  • CANONICAL BASE (geometryOnly false): coarse (goldbergLevelForPoints) + fully CPU-sampled —
    //    feature detection + saves depend on it, so it is never geometryOnly. Unchanged.
    //  • FINE GPU OVERLAY (geometryOnly true): a FINER whole-globe mesh (goldbergGlobeOverlayLevel)
    //    drawn at the zoomed-OUT view so its coastline matches the detail patches; its fields are
    //    computed on the GPU, so no CPU sampling here.
    if (halfAngle >= Math.PI) {
      const level = geometryOnly ? goldbergGlobeOverlayLevel(points) : goldbergLevelForPoints(points);
      const mesh = this.getMesh(level);
      const map = this.packMesh(mesh, points, continentalnessOverride, undefined, geometryOnly);
      map.genHalfAngle = halfAngle;
      map.genPoints = points;
      return map;
    }
    // Detail cap at a finer subdivision than the global mesh. Cells outside the inset cap, and
    // incomplete-ring boundary cells, are dropped inside the mesher. `geometryOnly` skips the per-cell
    // field sampling — the GPU path computes those fields on the renderer's context (no CPU noise).
    const keepHalfAngle = halfAngle * MESH.LOCAL_KEEP_FRACTION;
    const mesh = goldbergCapMesh(center, keepHalfAngle, goldbergCapLevel(points));
    // Cap (inset) the renderer uses to skip global base cells hidden by this patch.
    const cap = {
      center,
      cosKeep: Math.cos(
        Math.max(0, keepHalfAngle - (MESH.OCCLUSION_MARGIN_DEG * Math.PI) / 180)
      ),
    };
    const map = this.packMesh(mesh, mesh.length, continentalnessOverride, cap, geometryOnly);
    map.genHalfAngle = halfAngle;
    map.genPoints = points;
    return map;
  }

  /** Whole-globe map at a resolution's point count — thin adapter over `generate` for the /sweep +
   *  /explorer dev harnesses (the live app drives `generate` straight from the worker).
   *  `continentalnessOverride` is the /sweep flat-base hook. */
  public generateMap(input: MapSettings, continentalnessOverride?: number): GlobeMap {
    return this.generate(
      WHOLE_GLOBE_CENTER,
      Math.PI,
      globePointCount(input.resolution),
      continentalnessOverride
    );
  }

  /** Dense cap map around `center` — thin adapter over `generate` for the dev harnesses. */
  public generateLocalMap(
    center: Vec3,
    halfAngle: number,
    points: number,
    continentalnessOverride?: number
  ): GlobeMap {
    return this.generate(center, halfAngle, points, continentalnessOverride);
  }

  /**
   * Pack a mesh (sites + rings) and its computed fields into the flat typed-array GlobeMap in a
   * single pass: copy geometry into shared buffers and sample every per-cell field (elevation /
   * moisture / ice / shade / plate) via ElevationCalculator.sampleCell.
   */
  private packMesh(
    cells: MeshCell[],
    pointCount: number,
    continentalnessOverride: number | undefined,
    cap?: { center: Vec3; cosKeep: number },
    geometryOnly = false
  ): GlobeMap {
    const n = cells.length;
    let totalVerts = 0;
    for (let i = 0; i < n; i++) totalVerts += cells[i].ring.length;

    const sites = new Float32Array(n * 3);
    const ringOffsets = new Uint32Array(n + 1);
    const ringVerts = new Float32Array(totalVerts * 3);
    const elevation = new Float32Array(n);
    const reportElevation = new Float32Array(n);
    const moisture = new Float32Array(n);
    const ice = new Float32Array(n);
    const koppenZone = new Float32Array(n);
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
      // geometryOnly: leave the field arrays zeroed — the GPU computes them on the renderer's context.
      if (!geometryOnly) {
        const cell = this.elevationCalc.sampleCell(site, continentalnessOverride);
        elevation[i] = cell.elevation;
        reportElevation[i] = cell.reportElevation;
        moisture[i] = cell.moisture;
        ice[i] = cell.ice;
        koppenZone[i] = cell.koppenZone;
        shade[i] = cell.shade;
        plate[i] = cell.plate;
      }
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
      reportElevation,
      moisture,
      ice,
      koppenZone,
      shade,
      plate,
      arrowPositions: this.arrowData.positions,
      arrowDirections: this.arrowData.directions,
      rainfall: this.params.MOISTURE.RAINFALL,
      pointCount,
      maxRingRadius: Math.sqrt(maxChord2),
      cap,
    };
  }

  /** Build (or reuse) the global hex (Goldberg) mesh at a subdivision level. The grid is
   *  deterministic + nested, so it's stable across zoom (a finer level refines the coarse hexes in
   *  place rather than re-tessellating) and seed-independent, so it's cached + reused across seeds. */
  private getMesh(level: number): MeshCell[] {
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
}
