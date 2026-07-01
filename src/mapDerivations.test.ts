import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTuning, RIVERS, snapshotParams, type MapSettings } from "./common/settings";
import { createMapDerivations, type DerivationView, type FeatureComputeArgs, type MapDerivations } from "./mapDerivations";
import { computeMapFeatures, type MapFeatures } from "./mapgen/features";
import { buildCpuCalc, cpuRiverField } from "./mapgen/gpu/cpuField";
import { MapGenerator } from "./mapgen/MapGenerator";
import type { RiverFieldSampler } from "./mapgen/features/rivers";
import { NameGenerator } from "./mapgen/NameGenerator";

// The river + feature derivation used to be loose closures + an async debounce in main.ts, untestable
// without a DOM/WebGL canvas. As a module fed a fake (CPU) river sampler and an in-process postFeatures
// it tests directly — what we lock here is the CACHING + INVALIDATION + the async contract (sticky
// previous result, latest-wins, dedup, retry-after-failure), not pixels.
const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "derivations-seed";

// The CPU river-field sampler (the GPU sampler's twin) so rivers actually route and computeRivers
// returns a FRESH network per call, which lets us observe re-routing by reference.
function cpuSampler(seed: string): RiverFieldSampler {
  const cpu = buildCpuCalc(seed, PARAMS);
  return (sites) => cpuRiverField(cpu, sites, RIVERS.ROUGHNESS.value);
}

const buildMap = () => new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
const MAP = buildMap();

function make(postFeatures?: (args: FeatureComputeArgs) => Promise<MapFeatures>) {
  const view: DerivationView = { mapSeed: SEED, language: "GREEK", languagePool: ["GREEK", "LATIN"], paramsKey: "p0" };
  const onFeaturesReady = vi.fn();
  const d = createMapDerivations({
    sampleRiverField: cpuSampler(SEED),
    riverNamer: new NameGenerator("r"),
    view: () => view,
    // Default fake: the REAL derivation, run in-process but resolved asynchronously — same contract
    // as the worker (mapWorker builds a fresh namer per job the same way).
    postFeatures:
      postFeatures ??
      (async (args) =>
        computeMapFeatures(args.map, args.seaLevel, args.language, args.mapSeed, new NameGenerator("features"), args.languagePool, args.params, args.rivers)),
    onFeaturesReady,
  });
  return { d, onFeaturesReady };
}

// Kick the derivation and wait for the in-flight job to land, then return the settled result.
async function settled(d: MapDerivations, map = MAP): Promise<MapFeatures> {
  d.features(map); // kick (returns the sticky previous result or null)
  await new Promise((r) => setTimeout(r, 0)); // let the postFeatures promise chain land
  const result = d.features(map);
  expect(result).not.toBeNull();
  return result!;
}

afterEach(() => applyTuning({})); // restore any dial a test moved

describe("createMapDerivations", () => {
  it("memoises features and rivers for an unchanged map + dials", async () => {
    const { d } = make();
    const f = await settled(d);
    expect(d.features(MAP)).toBe(f); // same object — a cache hit, not a recompute
    expect(d.rivers(MAP)).toBe(d.rivers(MAP));
  }, 30_000);

  it("features() is null before the first derivation lands, then onFeaturesReady fires once", async () => {
    const { d, onFeaturesReady } = make();
    expect(d.peekFeatures(MAP)).toBeNull();
    expect(d.features(MAP)).toBeNull(); // kicked off-thread; nothing to draw yet
    expect(onFeaturesReady).not.toHaveBeenCalled();
    const f = await settled(d);
    expect(onFeaturesReady).toHaveBeenCalledTimes(1);
    expect(d.peekFeatures(MAP)).toBe(f);
  }, 30_000);

  it("invalidateFeatures re-derives features but keeps the SAME river network", async () => {
    const { d } = make();
    const f1 = await settled(d);
    const r1 = d.rivers(MAP);
    d.invalidateFeatures(MAP);
    expect(await settled(d)).not.toBe(f1); // a feature-only dial change → cities re-derive
    expect(d.rivers(MAP)).toBe(r1); // …but rivers are NOT rerouted
  }, 60_000);

  it("a routing-dial change reroutes rivers, keeps showing the STICKY old features, then re-derives", async () => {
    const { d } = make();
    const r1 = d.rivers(MAP);
    const f1 = await settled(d);
    RIVERS.MEANDER.value = RIVERS.MEANDER.value + 0.1; // a river routing dial moved
    expect(d.rivers(MAP)).not.toBe(r1); // a fresh network
    expect(d.features(MAP)).toBe(f1); // sticky: the old result draws while the new one derives
    const f2 = await settled(d);
    expect(f2).not.toBe(f1); // cities re-derived against the new network (features key on the rivers ref)
  }, 60_000);

  it("a new map object gets fresh, independent derivations", async () => {
    const { d } = make();
    const other = buildMap(); // identical content, distinct object identity
    const fMain = await settled(d);
    expect(d.peekFeatures(other)).toBeNull(); // not derived yet
    expect(await settled(d, other)).not.toBe(fMain); // keyed on the map object, so a distinct result
  }, 60_000);

  it("latest-wins: a superseded in-flight derivation is dropped, never shown", async () => {
    // Hand-resolvable jobs so two can be in flight around a dial change.
    const jobs: { args: FeatureComputeArgs; resolve: (f: MapFeatures) => void }[] = [];
    const { d, onFeaturesReady } = make(
      (args) => new Promise<MapFeatures>((resolve) => void jobs.push({ args, resolve }))
    );
    d.features(MAP); // kick job A at the current sea level
    RIVERS.MEANDER.value = RIVERS.MEANDER.value + 0.1; // routing dial → new rivers → new wanted key
    d.features(MAP); // kick job B (supersedes A)
    expect(jobs).toHaveLength(2);
    const fake = (tag: string): MapFeatures =>
      ({ features: [], countries: [], cities: [], borders: new Float32Array(0), countryOf: new Int32Array(0), grownCountryOf: new Int32Array(0), countryColors: new Int32Array(0), tag }) as unknown as MapFeatures;
    const a = fake("A");
    const b = fake("B");
    jobs[0].resolve(a); // A lands late — must be dropped
    jobs[1].resolve(b);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.features(MAP)).toBe(b);
    expect(onFeaturesReady).toHaveBeenCalledTimes(1); // only B's landing re-rendered
  }, 30_000);

  it("a failed derivation clears the in-flight slot so the next frame retries", async () => {
    let calls = 0;
    const { d } = make(async () => {
      calls++;
      throw new Error("worker exploded");
    });
    d.features(MAP);
    await new Promise((r) => setTimeout(r, 0));
    expect(d.features(MAP)).toBeNull(); // still nothing — but this call re-kicked
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(2);
  }, 30_000);
});
