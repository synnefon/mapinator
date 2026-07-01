import type { Vec3 } from "../common/3DMath";
import type { Language } from "../common/language";
import type { CountrySeeds, GlobeMap } from "../common/map";
import type { TerrainParams } from "../common/settings";
import { computeMapFeatures } from "./features";
import { patchCountryOf } from "./features/countries";
import { buildKdTree, type KdNode } from "./features/kdTree";
import type { RiverData } from "./features/rivers";
import { buildCpuCalc } from "./gpu/cpuField";
import { MapGenerator } from "./MapGenerator";
import { NameGenerator } from "./NameGenerator";

// Requests from the main thread. `config` carries the seed and/or the resolved generation params
// (TerrainParams) and/or the base country seeds; it must precede the first generate (postMessage
// ordering guarantees it lands first), and is re-sent whenever any of them change. The worker no
// longer replays applyTuning in its own realm — params arrive already resolved on the main thread.
// `generate` builds ONE LOD rung — the globe (halfAngle ≥ π) and every detail cap share it; a detail cap
// with `withCountry` also gets its per-cell country stamped (nearest base cell) from the broadcast partition.
/** Configure (or re-point) the worker's generator: a seed and/or params change, plus the broadcast base
 *  partition off which each detail patch's per-cell country is re-grown. */
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

/** Derive the feature set (countries / cities / labels / borders) for a base globe — the ~600ms
 *  computeMapFeatures pass, off the main thread so a sea-level / language / dial change never
 *  janks a frame. The map's arrays arrive structured-CLONED (never transferred — the main thread
 *  is still rendering that map); the result's fresh arrays transfer back zero-copy. Self-contained:
 *  everything the derivation reads rides in the request, none of the worker's configured state. */
export type FeaturesRequest = {
  id: number;
  kind: "features";
  map: GlobeMap;
  seaLevel: number;
  language: Language;
  mapSeed: string;
  languagePool: Language[];
  params: TerrainParams;
  rivers: RiverData;
};

type WorkerRequest = ConfigRequest | GenerateRequest | FeaturesRequest;

// `self` is typed as Window under the DOM lib; cast to Worker for the dedicated-
// worker postMessage(message, transfer) overload used for the zero-copy hand-off.
const ctx = self as unknown as Worker;

let gen: MapGenerator | null = null;
let seed: string | null = null; // remembered so a params-only config can rebuild at the same seed
let params: TerrainParams | null = null; // remembered so a seed-only config keeps the current dials
let countrySeeds: CountrySeeds | null = null; // base assignment to seed off-thread patch re-grows
// The CPU field twin — the patch's fine land/water for the per-cell country stamp, rebuilt with the dials.
let calc: ReturnType<typeof buildCpuCalc>["calc"] | null = null;
// A kd-tree of the base sites for fast no-alloc nearest-base-cell lookups — country-stamps each detail-patch
// cell at GENERATION (countrySeeds.countryOf is the grown base partition, so every cell maps to a country).
// Rebuilt when the base partition changes.
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
    // The per-cell country stamp reads the SAME generator field as the renderer (CPU twin), rebuilt w/ dials.
    if (req.seed !== undefined || req.params !== undefined) calc = buildCpuCalc(seed, params).calc;
  }
  // Index the base sites for nearest-base-cell country lookups (the per-patch country stamp).
  // Only rebuild when the base map actually changed (baseChanged) — a feature-only re-derive ships the
  // SAME sites, so the existing tree (an index structure read against the passed sites) stays valid and
  // the O(n log n) build would be wasted. `!baseTree` covers the first config / any worker without one.
  if (req.countrySeeds !== undefined && (req.countrySeeds.baseChanged || !baseTree)) {
    baseTree = buildKdTree(req.countrySeeds.sites, req.countrySeeds.sites.length / 3);
  }
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === "config") {
    handleConfigRequest(req);
    return;
  }
  if (req.kind === "features") {
    // A fresh namer per job: every feature-path name is drawn from an EXPLICIT seed (generate() is
    // pure in (seed, lang)) and computeMapFeatures resets the uniqueness namespace itself, so this
    // reproduces the main thread's old long-lived NameGenerator("features") byte for byte.
    const namer = new NameGenerator("features");
    const features = computeMapFeatures(
      req.map, req.seaLevel, req.language, req.mapSeed, namer, req.languagePool, req.params, req.rivers
    );
    // The result's typed arrays are freshly built — transfer them back zero-copy.
    ctx.postMessage({ id: req.id, features }, [
      features.borders.buffer,
      features.countryOf.buffer,
      features.grownCountryOf.buffer,
      features.countryColors.buffer,
    ]);
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

