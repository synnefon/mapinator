import { Vec3 } from "../common/3DMath";
import type { CountrySeeds } from "../common/map";
import type { TerrainParams } from "../common/settings";
import { PLANET_RADIUS_KM } from "./features/countries";
import { buildKdTree, type KdNode, nearestCell } from "./features/kdTree";
import { buildRiverGrid, growSettlements, makeSettlementWorld, RIVER_GRID_CELLS, SETTLEMENT_WATER_KINDS } from "./features/settlements";
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

/** Grow the in-view region's patch-local small-town field. Carries LIVE dial values (the worker's own
 *  settings copy is stale) so the tail routes + biases with the SAME values the big-city head did. */
export type TownsRequest = {
  id: number;
  kind: "towns";
  center: Vec3;
  capAngle: number; // angular radius of the in-view region
  gridAngle: number; // finest town spacing (rad)
  minPop: number; // per-level LOD floor
  ceilingPop: number; // handoff to the global big-city set
  perCapita: number; // people per settlement (1400 density target)
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
  if (req.countrySeeds !== undefined) baseTree = buildKdTree(req.countrySeeds.sites, req.countrySeeds.sites.length / 3);
}

function handleTownsRequest(req: TownsRequest) {
  // Grow the in-view region's patch-local settlement TAIL off-thread, through the SAME engine + routes the
  // main thread ran for the big-city head (makeSettlementWorld + growSettlements): accepted ∝ local
  // population density (coast/river-biased), routed + snapped to its water. ALWAYS respond so the pool
  // frees the worker, even if we can't compute yet.
  if (!calc || !baseTree || !countrySeeds) {
    ctx.postMessage({ id: req.id }); // not ready → null result; pool frees the worker
    return;
  }

  const seeds = countrySeeds;
  const tree = baseTree;
  const sample = calc;
  const cellSpacing = Math.sqrt((4 * Math.PI) / (seeds.sites.length / 3));
  // The drawn-river grid is rebuilt per grow so the live RIVER_MIN_STRENGTH applies (cheap: the network is
  // a bounded vertex set); the rest of the world is the shipped per-base-cell water arrays.
  const riverGrid = buildRiverGrid(seeds.riverPositions, seeds.riverWidths, req.riverMinStrength, RIVER_GRID_CELLS * cellSpacing);
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
  const towns = growSettlements({
    center: req.center, capAngle: req.capAngle, gridAngle: req.gridAngle, minPop: req.minPop,
    ceilingPop: req.ceilingPop, perCapita: req.perCapita, planetRadiusKm: PLANET_RADIUS_KM,
    world, seed: seed ?? "towns",
  });
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
    map.koppenZone.buffer,
    map.shade.buffer,
    map.plate.buffer,
    ...(map.countryOf ? [map.countryOf.buffer] : []), // per-cell country (when stamped at gen)
    // arrowPositions/arrowDirections are intentionally NOT transferred — they're memoized per seed
    // and shared across rungs, so they're structured-cloned (small) to keep the cache valid.
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};

