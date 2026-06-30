import { Vec3 } from "../common/3DMath";
import type { CountrySeeds } from "../common/map";
import type { TerrainParams } from "../common/settings";
import { patchCountryData, PLANET_RADIUS_KM } from "./features/countries";
import { growRegionTowns } from "./features/regionTowns";
import { cellSuitability } from "./features/suitability";
import { buildCpuCalc } from "./gpu/cpuField";
import { MapGenerator } from "./MapGenerator";

// Requests from the main thread. `config` carries the seed and/or the resolved generation params
// (TerrainParams) and/or the base country seeds; it must precede the first generate (postMessage
// ordering guarantees it lands first), and is re-sent whenever any of them change. The worker no
// longer replays applyTuning in its own realm — params arrive already resolved on the main thread.
// `generate` builds ONE LOD rung — the globe (halfAngle ≥ π) and every detail cap share it. `countries`
// re-grows a patch's country partition OFF the main thread (the heavy graph work, delivered async).
type WorkerRequest =
  | { id: number; kind: "config"; seed?: string; params?: TerrainParams; countrySeeds?: CountrySeeds }
  | {
      id: number;
      kind: "generate";
      center: Vec3;
      halfAngle: number;
      points: number;
      geometryOnly?: boolean; // mesh only (no per-cell field sampling) — the GPU computes fields
    }
  | { id: number; kind: "countries"; center: Vec3; halfAngle: number; points: number; elevation?: Float32Array }
  | {
      id: number;
      kind: "towns";
      center: Vec3;
      capAngle: number; // angular radius of the in-view region
      gridAngle: number; // finest town spacing (rad)
      minPop: number; // per-level LOD floor
      ceilingPop: number; // handoff to the global big-city set
      perCapita: number; // people per settlement (1400 density target)
      popDensityScale: number; // live GLOBAL_POPULATION_DENSITY (the worker's own dial copy is stale)
    };

// `self` is typed as Window under the DOM lib; cast to Worker for the dedicated-
// worker postMessage(message, transfer) overload used for the zero-copy hand-off.
const ctx = self as unknown as Worker;

let gen: MapGenerator | null = null;
let seed: string | null = null; // remembered so a params-only config can rebuild at the same seed
let params: TerrainParams | null = null; // remembered so a seed-only config keeps the current dials
let countrySeeds: CountrySeeds | null = null; // base assignment to seed off-thread patch re-grows
// For the patch-local town field: the CPU field twin (population density via suitability) + a spatial hash
// of the base sites for fast nearest-seed country assignment. Both rebuilt when their inputs change.
let calc: ReturnType<typeof buildCpuCalc>["calc"] | null = null;
let siteGrid: SiteGrid | null = null;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === "config") {
    if (req.seed !== undefined) seed = req.seed;
    if (req.params !== undefined) params = req.params;
    if (req.countrySeeds !== undefined) countrySeeds = req.countrySeeds;
    // Build (first time) or re-point the generator once both seed and params are known. The mesh
    // cache lives on the generator instance, so configure() keeps it across seed / param changes.
    if (seed !== null && params !== null) {
      if (gen) gen.configure(seed, params);
      else gen = new MapGenerator(seed, params);
      // The town field reads the SAME generator field as the renderer (CPU twin), rebuilt with the dials.
      if (req.seed !== undefined || req.params !== undefined) calc = buildCpuCalc(seed, params).calc;
    }
    // Hash the base sites for O(1) nearest-seed country lookups when growing the town field.
    if (req.countrySeeds !== undefined) siteGrid = buildSiteGrid(req.countrySeeds.sites);
    return;
  }

  if (req.kind === "towns") {
    // Grow the in-view region's small towns off-thread: a deterministic field accepted ∝ local population
    // density (the same cellSuitability the country populations use), country-stamped by nearest base seed.
    // ALWAYS respond so the pool frees the worker, even if we can't compute yet.
    if (calc && siteGrid && countrySeeds) {
      const seaLevel = countrySeeds.seaLevel;
      const seeds = countrySeeds;
      const grid = siteGrid;
      const sample = calc;
      const popDensityAt = (p: Vec3): number => {
        const c = sample.sampleCell(p);
        if (c.elevation < seaLevel) return 0; // water
        const latDeg = (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI;
        // slope 0 + no coast bonus for v1: towns cluster by the climate/terrain niche; refine later.
        const suit = cellSuitability({ latDeg, reportElevation: c.reportElevation, moisture: c.moisture, ice: c.ice, slope: 0 }, seaLevel);
        return req.popDensityScale * suit;
      };
      const countryAt = (p: Vec3): number => {
        const i = nearestSite(grid, p);
        return i < 0 ? -1 : seeds.countryOf[i];
      };
      const towns = growRegionTowns({
        center: req.center, capAngle: req.capAngle, gridAngle: req.gridAngle, minPop: req.minPop,
        ceilingPop: req.ceilingPop, perCapita: req.perCapita, planetRadiusKm: PLANET_RADIUS_KM,
        popDensityAt, countryAt, seed: seed ?? "towns",
      });
      const n = towns.length;
      const positions = new Float32Array(3 * n);
      const populations = new Float32Array(n);
      const countries = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        positions[3 * i] = towns[i].anchor.x;
        positions[3 * i + 1] = towns[i].anchor.y;
        positions[3 * i + 2] = towns[i].anchor.z;
        populations[i] = towns[i].population;
        countries[i] = towns[i].countryIndex;
      }
      ctx.postMessage({ id: req.id, towns: { positions, populations, countries } }, [positions.buffer, populations.buffer, countries.buffer] as Transferable[]);
    } else {
      ctx.postMessage({ id: req.id }); // not ready → null result; pool frees the worker
    }
    return;
  }
  if (req.kind === "countries") {
    // Re-grow the patch's country partition off the main thread. Reproduce the EXACT render mesh
    // (generate is deterministic in center/halfAngle/points, and geometryOnly doesn't change geometry)
    // so the result aligns cell-for-cell, then run the shared land-constrained grow vs. the base seeds.
    // ALWAYS respond — even if we can't compute yet — so the pool resolves and frees the worker.
    if (gen && countrySeeds) {
      // GPU-read elevation (req.elevation) → regen the MESH ONLY (deterministic, matches the rendered
      // patch cell-for-cell) and classify land/water from it, so the re-grown coast matches the drawn
      // one. Without it (CPU-fallback path), sample the full field here and use that.
      const fineElev = req.elevation;
      const map = gen.generate(req.center, req.halfAngle, req.points, undefined, fineElev !== undefined);
      const base = {
        sites: countrySeeds.sites,
        cellCount: countrySeeds.sites.length / 3,
        elevation: countrySeeds.elevation,
      };
      const { countryOf } = patchCountryData(map, fineElev ?? map.elevation, countrySeeds.seaLevel, base, countrySeeds.countryOf);
      ctx.postMessage({ id: req.id, country: { countryOf } }, [countryOf.buffer] as Transferable[]);
    } else {
      ctx.postMessage({ id: req.id }); // not ready → null result; pool frees the worker
    }
    return;
  }

  if (!gen) return; // a generate arrived before any config — shouldn't happen
  const map = gen.generate(req.center, req.halfAngle, req.points, undefined, req.geometryOnly);

  // The typed arrays are freshly built per call, so transfer their buffers
  // zero-copy — the worker keeps no reference once posted.
  const transfer = [
    map.sites.buffer,
    map.ringOffsets.buffer,
    map.ringVerts.buffer,
    map.elevation.buffer,
    map.reportElevation.buffer,
    map.moisture.buffer,
    map.ice.buffer,
    map.shade.buffer,
    map.plate.buffer,
    // arrowPositions/arrowDirections are intentionally NOT transferred — they're memoized per seed
    // and shared across rungs, so they're structured-cloned (small) to keep the cache valid.
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};

// === Nearest base-seed lookup: a cube-grid hash of the base sites (unit vectors) ===
// Town candidates inherit the country of their nearest base cell; this makes that O(1). An empty
// neighbourhood (open ocean) returns -1, which the caller treats as unclaimed → no town.
type SiteGrid = { sites: Float32Array; inv: number; buckets: Map<string, number[]> };

const gridKey = (x: number, y: number, z: number): string => `${x}|${y}|${z}`;

function buildSiteGrid(sites: Float32Array): SiteGrid {
  const n = sites.length / 3;
  const spacing = Math.sqrt((4 * Math.PI) / Math.max(1, n)); // mean angular site spacing on the unit sphere
  const inv = 1 / (1.5 * spacing); // bucket ≥ spacing so the 3×3×3 scan never misses the nearest site
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = gridKey(Math.round(sites[3 * i] * inv), Math.round(sites[3 * i + 1] * inv), Math.round(sites[3 * i + 2] * inv));
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  return { sites, inv, buckets };
}

function nearestSite(g: SiteGrid, p: Vec3): number {
  const gx = Math.round(p.x * g.inv);
  const gy = Math.round(p.y * g.inv);
  const gz = Math.round(p.z * g.inv);
  let best = -1;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const b = g.buckets.get(gridKey(gx + dx, gy + dy, gz + dz));
        if (!b) continue;
        for (const i of b) {
          const ex = g.sites[3 * i] - p.x;
          const ey = g.sites[3 * i + 1] - p.y;
          const ez = g.sites[3 * i + 2] - p.z;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
    }
  }
  return best;
}
