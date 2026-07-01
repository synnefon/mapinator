import { Vec3 } from "../common/3DMath";
import type { CountrySeeds } from "../common/map";
import type { TerrainParams } from "../common/settings";
import { PLANET_RADIUS_KM, patchCountryOf } from "./features/countries";
import { buildKdTree, type KdNode, nearestCell } from "./features/kdTree";
import { buildRiverGrid, finishSettlements, makeSettlementWorld, type PlacedCandidate, RIVER_GRID_CELLS, scanScale, SETTLEMENT_WATER_KINDS, topByPopulation } from "./features/settlements";
import { buildCpuCalc } from "./gpu/cpuField";
import { MapGenerator } from "./MapGenerator";

// Requests from the main thread. `config` carries the seed and/or the resolved generation params
// (TerrainParams) and/or the base country seeds; it must precede the first generate (postMessage
// ordering guarantees it lands first), and is re-sent whenever any of them change. The worker no
// longer replays applyTuning in its own realm — params arrive already resolved on the main thread.
// `generate` builds ONE LOD rung — the globe (halfAngle ≥ π) and every detail cap share it; a detail cap
// with `withCountry` also gets its per-cell country stamped (nearest base cell). `towns` grows a region's
// patch-local small-town field. Both read the broadcast base partition (countrySeeds).
/** Configure (or re-point) the worker's generator: a seed and/or params change, plus the broadcast base
 *  partition off which patch re-grows + the town field are seeded. */
export type ConfigRequest = {
  id: number;
  kind: "config";
  seed?: string;
  params?: TerrainParams;
  countrySeeds?: CountrySeeds;
};

/** Generate one mesh patch (a spherical cap). `geometryOnly` skips per-cell field sampling (the GPU
 *  computes fields); `withCountry` stamps each cell's country from the grown base partition. */
export type GenerateRequest = {
  id: number;
  kind: "generate";
  center: Vec3;
  halfAngle: number;
  points: number;
  geometryOnly?: boolean; // mesh only (no per-cell field sampling) — the GPU computes fields
  withCountry?: boolean; // stamp per-cell country from the grown base partition (detail caps, layer on)
};

/** Grow the in-view region's patch-local town field. Carries LIVE dial values (the worker's own settings copy
 *  is stale) so the tail routes + biases + sizes with the SAME values the big-city head did. */
export type TownsRequest = {
  id: number;
  kind: "towns";
  center: Vec3;
  capAngle: number; // angular radius of the in-view region
  scaleAngles: number[]; // the fixed scales (rad) to scan — each sets a catchment area, hence a size band
  urbanFraction: number; // density × catchment × this = a candidate's population
  maxCount: number; // render floor: keep only the largest this-many settlements in the cap
  popDensityScale: number; // live GLOBAL_POPULATION_DENSITY
  coastStrength: number; // live POPULATION.COAST_STRENGTH
  coastFalloff: number; // live POPULATION.COAST_FALLOFF
  desertAversion: number; // live CITY.DESERT_AVERSION
  iceAversion: number; // live CITY.ICE_AVERSION
  riverMinStrength: number; // live CITY.RIVER_MIN_STRENGTH — the drawn-river floor the snap grid keys on
};

type WorkerRequest = ConfigRequest | GenerateRequest | TownsRequest;

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
// The drawn-river snap grid, cached across town grows: it depends only on the river network (stable within
// a config) + the live river floor, so rebuilding it per grow (string-keyed bucket Map) is wasted on a pan.
let cachedRiverGrid: ReturnType<typeof buildRiverGrid> | null = null;
let riverGridSeeds: CountrySeeds | null = null; // the countrySeeds the cached grid was built from (identity)
let riverGridMinStrength = -1; // and the live river floor it used

function handleConfigRequest(req: ConfigRequest) {
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
  // Only rebuild when the base map actually changed (baseChanged) — a feature-only re-derive ships the
  // SAME sites, so the existing tree (an index structure read against the passed sites) stays valid and
  // the O(n log n) build would be wasted. `!baseTree` covers the first config / any worker without one.
  if (req.countrySeeds !== undefined && (req.countrySeeds.baseChanged || !baseTree)) {
    baseTree = buildKdTree(req.countrySeeds.sites, req.countrySeeds.sites.length / 3);
  }
}

function handleTownsRequest(req: TownsRequest) {
  // Grow the in-view region's patch-local settlement TAIL off-thread, through the SAME engine + routes the
  // main thread ran for the big-city head (makeSettlementWorld + scanScale): population = density × the scale's
  // catchment (coast/river-biased), routed + snapped to its water. ALWAYS respond so the pool frees the worker,
  // even if we can't compute yet.
  if (!calc || !baseTree || !countrySeeds) {
    ctx.postMessage({ id: req.id }); // not ready → null result; pool frees the worker
    return;
  }

  const seeds = countrySeeds;
  const tree = baseTree;
  const sample = calc;
  const cellSpacing = Math.sqrt((4 * Math.PI) / (seeds.sites.length / 3));
  // Rebuild the drawn-river snap grid only when the network (seeds identity) or the live RIVER_MIN_STRENGTH
  // changed — otherwise reuse it across grows (a pan re-runs this with the same network + floor).
  if (!cachedRiverGrid || riverGridSeeds !== seeds || riverGridMinStrength !== req.riverMinStrength) {
    cachedRiverGrid = buildRiverGrid(seeds.riverPositions, seeds.riverWidths, req.riverMinStrength, RIVER_GRID_CELLS * cellSpacing);
    riverGridSeeds = seeds;
    riverGridMinStrength = req.riverMinStrength;
  }
  const riverGrid = cachedRiverGrid;
  const world = makeSettlementWorld({
    sampleCell: (p) => sample.sampleCell(p),
    seaLevel: seeds.seaLevel,
    nearestCell: (p) => nearestCell(tree, seeds.sites, p.x, p.y, p.z),
    countryOf: seeds.countryOf,
    coastDist: seeds.coastDist,
    seaDist: seeds.seaDist,
    coastDir: seeds.coastDir,
    riverGrid,
    cellSpacing,
    densityScale: req.popDensityScale,
    coastStrength: req.coastStrength,
    coastFalloff: req.coastFalloff,
    desertAversion: req.desertAversion,
    iceAversion: req.iceAversion,
  });
  // Scan each fixed scale over the cap (size = density × the scale's catchment), rank the union, and keep the
  // largest `maxCount` — the render floor. Route only those survivors into full markers.
  const candidates: PlacedCandidate[] = [];
  for (const gridAngle of req.scaleAngles) {
    candidates.push(...scanScale({
      center: req.center, capAngle: req.capAngle, gridAngle, urbanFraction: req.urbanFraction,
      planetRadiusKm: PLANET_RADIUS_KM, world, seed: seed ?? "towns",
    }));
  }
  const towns = finishSettlements(topByPopulation(candidates, req.maxCount), world);
  const n = towns.length;
  const positions = new Float32Array(3 * n);
  const populations = new Float32Array(n);
  const countries = new Int32Array(n);
  const waterKind = new Uint8Array(n);
  const rawElevation = new Float32Array(n);
  const reportElevation = new Float32Array(n);
  const moisture = new Float32Array(n);
  const ice = new Float32Array(n);
  const coastDist = new Int32Array(n);
  const seaDist = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const t = towns[i];
    positions[3 * i] = t.anchor.x;
    positions[3 * i + 1] = t.anchor.y;
    positions[3 * i + 2] = t.anchor.z;
    populations[i] = t.population;
    countries[i] = t.countryIndex;
    waterKind[i] = SETTLEMENT_WATER_KINDS.indexOf(t.waterKind);
    rawElevation[i] = t.rawElevation;
    reportElevation[i] = t.reportElevation;
    moisture[i] = t.moisture;
    ice[i] = t.ice;
    coastDist[i] = t.coastDist;
    seaDist[i] = t.seaDist;
  }
  ctx.postMessage(
    { id: req.id, towns: { positions, populations, countries, waterKind, rawElevation, reportElevation, moisture, ice, coastDist, seaDist } },
    [positions.buffer, populations.buffer, countries.buffer, waterKind.buffer, rawElevation.buffer, reportElevation.buffer, moisture.buffer, ice.buffer, coastDist.buffer, seaDist.buffer] as Transferable[]
  );
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === "config") {
    handleConfigRequest(req);
    return;
  }

  if (req.kind === "towns") {
    handleTownsRequest(req);
    return;
  }
  if (!gen) return; // a generate arrived before any config — shouldn't happen
  const map = gen.generate(req.center, req.halfAngle, req.points, undefined, req.geometryOnly);

  // Stamp each patch cell's country AT GENERATION by RE-GROWING the partition on the patch's OWN fine mesh
  // (land-constrained Dijkstra, water a hard barrier), so the choropleth / hover highlight / dotted borders
  // follow the FINE coastline and SHARPEN with zoom — instead of the coarse base-cell Voronoi a plain
  // nearest-base-cell stamp gives (blocky, fixed on zoom). `calc` (the CPU field twin) supplies the patch's
  // fine land/water — the exact coastline the base globe + GPU field draw. One-time per patch, off-thread;
  // the LOD pipeline caches the result with the mesh. (calc is always built alongside `gen` in config.)
  if (req.withCountry && countrySeeds && baseTree && calc) {
    const seaLevel = countrySeeds.seaLevel;
    const sample = calc;
    const s = map.sites;
    const land = new Uint8Array(map.cellCount);
    for (let i = 0; i < map.cellCount; i++) {
      land[i] = sample.sampleCell({ x: s[3 * i], y: s[3 * i + 1], z: s[3 * i + 2] }).elevation >= seaLevel ? 1 : 0;
    }
    map.countryOf = patchCountryOf(map, (i) => land[i] === 1, baseTree, countrySeeds.sites, countrySeeds.countryOf);
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
    map.koppenZone.buffer,
    map.shade.buffer,
    map.plate.buffer,
    ...(map.countryOf ? [map.countryOf.buffer] : []), // per-cell country (when stamped at gen)
    // arrowPositions/arrowDirections are intentionally NOT transferred — they're memoized per seed
    // and shared across rungs, so they're structured-cloned (small) to keep the cache valid.
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};

