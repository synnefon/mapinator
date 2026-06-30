import { Vec3 } from "../common/3DMath";
import type { CountrySeeds } from "../common/map";
import type { TerrainParams } from "../common/settings";
import { PLANET_RADIUS_KM } from "./features/countries";
import { buildKdTree, type KdNode, nearestCell } from "./features/kdTree";
import { growRegionTowns } from "./features/regionTowns";
import { cellSuitability } from "./features/suitability";
import { buildCpuCalc } from "./gpu/cpuField";
import { MapGenerator } from "./MapGenerator";

// Requests from the main thread. `config` carries the seed and/or the resolved generation params
// (TerrainParams) and/or the base country seeds; it must precede the first generate (postMessage
// ordering guarantees it lands first), and is re-sent whenever any of them change. The worker no
// longer replays applyTuning in its own realm — params arrive already resolved on the main thread.
// `generate` builds ONE LOD rung — the globe (halfAngle ≥ π) and every detail cap share it; a detail cap
// with `withCountry` also gets its per-cell country stamped (nearest base cell). `towns` grows a region's
// patch-local small-town field. Both read the broadcast base partition (countrySeeds).
type WorkerRequest =
  | { id: number; kind: "config"; seed?: string; params?: TerrainParams; countrySeeds?: CountrySeeds }
  | {
      id: number;
      kind: "generate";
      center: Vec3;
      halfAngle: number;
      points: number;
      geometryOnly?: boolean; // mesh only (no per-cell field sampling) — the GPU computes fields
      withCountry?: boolean; // stamp per-cell country from the grown base partition (detail caps, layer on)
    }
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
// The CPU field twin (population density via suitability) for the town field, rebuilt with the dials.
let calc: ReturnType<typeof buildCpuCalc>["calc"] | null = null;
// A kd-tree of the base sites for fast no-alloc nearest-base-cell lookups — country-stamps each detail-patch
// cell at GENERATION and each town candidate (countrySeeds.countryOf is the grown base partition, so every
// cell maps to a country). Rebuilt when the base partition changes.
let baseTree: KdNode | null = null;

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
    // Index the base sites for nearest-base-cell country lookups (the per-patch stamp + the town field).
    if (req.countrySeeds !== undefined) baseTree = buildKdTree(req.countrySeeds.sites, req.countrySeeds.sites.length / 3);
    return;
  }

  if (req.kind === "towns") {
    // Grow the in-view region's small towns off-thread: a deterministic field accepted ∝ local population
    // density (the same cellSuitability the country populations use), country-stamped by nearest base seed.
    // ALWAYS respond so the pool frees the worker, even if we can't compute yet.
    if (calc && baseTree && countrySeeds) {
      const seaLevel = countrySeeds.seaLevel;
      const seeds = countrySeeds;
      const tree = baseTree;
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
        const i = nearestCell(tree, seeds.sites, p.x, p.y, p.z);
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
  if (!gen) return; // a generate arrived before any config — shouldn't happen
  const map = gen.generate(req.center, req.halfAngle, req.points, undefined, req.geometryOnly);

  // Stamp each patch cell's country AT GENERATION: nearest base cell in the broadcast grown partition. No
  // field, no GPU readback, no async re-grow — the choropleth/highlight colour correctly the instant the
  // mesh lands. Cost is O(cells) proportional to the gen the pipeline already committed to (never the
  // bottleneck), so there's no cell cap — the deepest patches, where the equirect looks blockiest, get it too.
  if (req.withCountry && countrySeeds && baseTree) {
    const co = new Int32Array(map.cellCount);
    const bs = countrySeeds.sites;
    const grown = countrySeeds.countryOf;
    for (let i = 0; i < map.cellCount; i++) {
      const bc = nearestCell(baseTree, bs, map.sites[3 * i], map.sites[3 * i + 1], map.sites[3 * i + 2]);
      co[i] = bc >= 0 ? grown[bc] : -1;
    }
    map.countryOf = co;
  }

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
    ...(map.countryOf ? [map.countryOf.buffer] : []), // per-cell country (when stamped at gen)
    // arrowPositions/arrowDirections are intentionally NOT transferred — they're memoized per seed
    // and shared across rungs, so they're structured-cloned (small) to keep the cache valid.
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};

