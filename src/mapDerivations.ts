import type { Language } from "./common/language";
import type { GlobeMap } from "./common/map";
import { OCEANS, RIVERS, snapshotParams, type TerrainParams } from "./common/settings";
import type { MapFeatures } from "./mapgen/features";
import { computeRivers, ROUTING_DIAL_KEYS, type RiverData, type RiverFieldSampler } from "./mapgen/features/rivers";
import type { NameGenerator } from "./mapgen/NameGenerator";

// The per-map inputs that aren't global dials — read LIVE through a getter so a seed / language /
// terrain change flows through without re-wiring the module.
export type DerivationView = {
  mapSeed: string;
  language: Language;
  languagePool: Language[];
  // A cheap token that changes whenever the generation params (terrain shape, incl. sea level) change.
  // main keeps it as JSON.stringify(snapshotParams()); the river signature keys on it so rivers refresh
  // on a terrain change without re-stringifying the whole param set every frame.
  paramsKey: string;
};

/** Everything one feature derivation reads — posted whole to the worker (self-contained job). */
export type FeatureComputeArgs = {
  map: GlobeMap;
  seaLevel: number;
  language: Language;
  mapSeed: string;
  languagePool: Language[];
  params: TerrainParams;
  rivers: RiverData;
};

export type MapDerivationsDeps = {
  sampleRiverField: RiverFieldSampler; // GPU field sampler (null when there's no float RT → no rivers)
  riverNamer: NameGenerator;
  view: () => DerivationView;
  /** Run one feature derivation OFF the main thread (main wires this to WorkerPool.computeFeatures;
   *  tests inject an in-process fake). Resolves with the derived feature set. */
  postFeatures: (args: FeatureComputeArgs) => Promise<MapFeatures>;
  /** A requested derivation landed and is now the current result — re-render (main: scheduleRender). */
  onFeaturesReady: () => void;
};

/**
 * Owns the derived data for the current base globe — the river network AND the feature set (labels,
 * countries, cities, choropleth) — computed RIVERS FIRST so each city is placed against the final
 * river network. Rivers route synchronously here (the GPU samples their field; the graph work is
 * comparatively light); the FEATURE derivation (~600ms) runs OFF-THREAD via postFeatures, with the
 * LodPipeline discipline:
 *   - STICKY: while a new derivation is in flight, features() keeps returning the previous result
 *     (or null before the first ever lands) — the frame never blocks and never blanks.
 *   - LATEST-WINS: a landing result is dropped unless it's still the one the current dials want
 *     (key compared by reference-captured request), so stale jobs can't overwrite fresh ones.
 *   - DEDUP: an in-flight request for the wanted key is never re-posted.
 * When a wanted result lands, onFeaturesReady fires so the caller re-renders with it.
 *
 * Both caches key on the base GlobeMap (a regen → a new map object → fresh derivations) plus the live
 * dials that actually affect each: rivers on the seed + terrain + routing dials; features on sea level
 * + language + the river network — the rivers-features coupling lives in the cache key, not in a
 * hand-written delete. No DOM / WebGL here — unit-testable with a fake sampler + fake postFeatures.
 */
export type MapDerivations = {
  rivers(baseMap: GlobeMap): RiverData;
  /** The feature set for the current dials — the cached result when fresh; otherwise KICKS an
   *  off-thread derivation and returns the previous (sticky) result, or null before the first. */
  features(baseMap: GlobeMap): MapFeatures | null;
  // The cached features WITHOUT forcing a compute — for the hover overlay, which only runs while the
  // country layer (hence a prior features() this frame) is live. Null if nothing's landed yet.
  peekFeatures(baseMap: GlobeMap): MapFeatures | null;
  // Drop the feature cache for a base map: a feature-only dial (CITY / POPULATION / COUNTRY) changed,
  // which touches neither the river network nor the terrain, so only cities/countries re-derive.
  invalidateFeatures(baseMap: GlobeMap): void;
};

export function createMapDerivations(deps: MapDerivationsDeps): MapDerivations {
  type RiverEntry = { sig: string; rivers: RiverData };
  // What the feature derivation was computed against. Compared by field (rivers by reference); the
  // wanted-key OBJECT is also the in-flight token, so a landing job checks it superseded itself.
  type FeatureKey = { seaLevel: number; language: Language; rivers: RiverData };
  type FeatureEntry = {
    key: FeatureKey | null; // what `result` was derived for (null until the first result lands)
    result: MapFeatures | null; // latest landed result — possibly for an OLDER key (sticky display)
    inFlight: FeatureKey | null; // the key being derived off-thread right now (dedup + latest-wins)
  };
  const riverCache = new WeakMap<GlobeMap, RiverEntry>();
  const featureCache = new WeakMap<GlobeMap, FeatureEntry>();

  // Everything the routed network depends on: the seed + terrain (paramsKey covers shape AND sea
  // level) + the routing dials — whose list lives WITH RiverOptions (rivers.ts:ROUTING_DIAL_KEYS),
  // so a new routing dial can't be forgotten here.
  const riverSignature = (): string => {
    const { mapSeed, paramsKey } = deps.view();
    return [mapSeed, paramsKey, ...ROUTING_DIAL_KEYS.map((k) => RIVERS[k].value)].join("|");
  };

  const rivers = (baseMap: GlobeMap): RiverData => {
    const sig = riverSignature();
    const cached = riverCache.get(baseMap);
    if (cached && cached.sig === sig) return cached.rivers;
    const { mapSeed, language } = deps.view();
    const result = computeRivers(deps.sampleRiverField, {
      seaLevel: OCEANS.SEA_LEVEL.value,
      minDrainage: RIVERS.MIN_DRAINAGE.value,
      moistureWeight: RIVERS.MOISTURE_WEIGHT.value,
      sourceMoisture: RIVERS.SOURCE_MOISTURE.value,
      waterScaling: RIVERS.WATER_SCALING.value,
      branching: RIVERS.BRANCHING.value,
      meander: RIVERS.MEANDER.value,
      meanderDetail: RIVERS.MEANDER_DETAIL.value,
      namer: deps.riverNamer,
      mapSeed,
      language,
    });
    riverCache.set(baseMap, { sig, rivers: result });
    return result;
  };

  const sameKey = (a: FeatureKey, b: FeatureKey): boolean =>
    a.seaLevel === b.seaLevel && a.language === b.language && a.rivers === b.rivers;

  const features = (baseMap: GlobeMap): MapFeatures | null => {
    const seaLevel = OCEANS.SEA_LEVEL.value;
    const { mapSeed, language, languagePool } = deps.view();
    const riverData = rivers(baseMap); // RIVERS FIRST — cities snap to the final network, placed once
    let entry = featureCache.get(baseMap);
    if (!entry) {
      entry = { key: null, result: null, inFlight: null };
      featureCache.set(baseMap, entry);
    }
    const wanted: FeatureKey = { seaLevel, language, rivers: riverData };
    if (entry.key && sameKey(entry.key, wanted)) return entry.result; // fresh — the common frame

    if (!entry.inFlight || !sameKey(entry.inFlight, wanted)) {
      entry.inFlight = wanted; // replacing a stale in-flight key makes that job land as a no-op
      deps
        .postFeatures({ map: baseMap, seaLevel, language, mapSeed, languagePool, params: snapshotParams(), rivers: riverData })
        .then((result) => {
          // Accept only if this entry is still live (not invalidated/replaced) and this job is still
          // the one the dials want — latest-wins.
          if (featureCache.get(baseMap) !== entry || entry.inFlight !== wanted) return;
          entry.key = wanted;
          entry.result = result;
          entry.inFlight = null;
          deps.onFeaturesReady();
        })
        .catch((err) => {
          if (featureCache.get(baseMap) === entry && entry.inFlight === wanted) entry.inFlight = null; // allow a retry
          console.error("feature derivation failed:", err);
        });
    }
    return entry.result; // sticky: the previous result while the new one derives (null before the first)
  };

  return {
    rivers,
    features,
    peekFeatures: (baseMap) => featureCache.get(baseMap)?.result ?? null,
    invalidateFeatures: (baseMap) => void featureCache.delete(baseMap),
  };
}
