import { afterEach, describe, expect, it } from "vitest";
import { applyTuning, RIVERS, snapshotParams, type MapSettings } from "./common/settings";
import { createMapDerivations, type DerivationView } from "./mapDerivations";
import { buildCpuCalc } from "./mapgen/gpu/cpuField";
import { MapGenerator } from "./mapgen/MapGenerator";
import type { RiverFieldSampler } from "./mapgen/features/rivers";
import { NameGenerator } from "./mapgen/NameGenerator";

// The river + feature derivation used to be loose closures + an async debounce in main.ts, untestable
// without a DOM/WebGL canvas. As a module fed a fake (CPU) river sampler it tests directly — what we lock
// here is the CACHING + INVALIDATION (the locality the extraction bought), not pixels.
const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "derivations-seed";

// A CPU river-field sampler (the GPU path's twin — see cityWaterAudit.test.ts) so rivers actually route
// and computeRivers returns a FRESH network per call, which lets us observe re-routing by reference.
function cpuSampler(seed: string): RiverFieldSampler {
  const { calc } = buildCpuCalc(seed, PARAMS);
  return (sites) => {
    const m = sites.length / 3;
    const elevation = new Float32Array(m);
    const reportElevation = new Float32Array(m);
    const moisture = new Float32Array(m);
    const ice = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const c = calc.sampleCell({ x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
      elevation[i] = c.elevation;
      reportElevation[i] = c.reportElevation;
      moisture[i] = c.moisture;
      ice[i] = c.ice;
    }
    return { elevation, reportElevation, moisture, ice };
  };
}

const buildMap = () => new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
const MAP = buildMap();

function make() {
  const view: DerivationView = { mapSeed: SEED, language: "GREEK", languagePool: ["GREEK", "LATIN"], paramsKey: "p0" };
  const d = createMapDerivations({
    sampleRiverField: cpuSampler(SEED),
    featureNamer: new NameGenerator("f"),
    riverNamer: new NameGenerator("r"),
    view: () => view,
  });
  return { d };
}

afterEach(() => applyTuning({})); // restore any dial a test moved

describe("createMapDerivations", () => {
  it("memoises features and rivers for an unchanged map + dials", () => {
    const { d } = make();
    expect(d.features(MAP)).toBe(d.features(MAP)); // same object — a cache hit, not a recompute
    expect(d.rivers(MAP)).toBe(d.rivers(MAP));
  }, 30_000);

  it("peekFeatures is null until features() runs, then returns the cached result", () => {
    const { d } = make();
    expect(d.peekFeatures(MAP)).toBeNull();
    const f = d.features(MAP);
    expect(d.peekFeatures(MAP)).toBe(f);
  }, 30_000);

  it("invalidateFeatures re-derives features but keeps the SAME river network", () => {
    const { d } = make();
    const f1 = d.features(MAP);
    const r1 = d.rivers(MAP);
    d.invalidateFeatures(MAP);
    expect(d.features(MAP)).not.toBe(f1); // a feature-only dial change → cities re-derive
    expect(d.rivers(MAP)).toBe(r1); // …but rivers are NOT rerouted
  }, 30_000);

  it("a routing-dial change reroutes rivers AND re-derives features (coupling lives in the cache key)", () => {
    const { d } = make();
    const r1 = d.rivers(MAP);
    const f1 = d.features(MAP);
    RIVERS.MEANDER.value = RIVERS.MEANDER.value + 0.1; // a river routing dial moved
    expect(d.rivers(MAP)).not.toBe(r1); // a fresh network
    expect(d.features(MAP)).not.toBe(f1); // cities re-derived against it — features key on the rivers ref
  }, 30_000);

  it("a new map object gets fresh, independent derivations", () => {
    const { d } = make();
    const other = buildMap(); // identical content, distinct object identity
    const fMain = d.features(MAP);
    expect(d.peekFeatures(other)).toBeNull(); // not derived yet
    expect(d.features(other)).not.toBe(fMain); // keyed on the map object, so a distinct result
  }, 30_000);
});
