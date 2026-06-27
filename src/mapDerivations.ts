import type { Language } from "./common/language";
import type { GlobeMap } from "./common/map";
import { OCEANS, RIVERS, snapshotParams } from "./common/settings";
import { computeMapFeatures, type MapFeatures } from "./mapgen/features";
import { computeRivers, type RiverData, type RiverFieldSampler } from "./mapgen/features/rivers";
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

export type MapDerivationsDeps = {
  sampleRiverField: RiverFieldSampler; // GPU field sampler (null when there's no float RT → no rivers)
  featureNamer: NameGenerator;
  riverNamer: NameGenerator;
  view: () => DerivationView;
};

/**
 * Owns the derived data for the current base globe — the river network AND the feature set (labels,
 * countries, cities, choropleth) — computed RIVERS FIRST so each city is placed against the final
 * river network in ONE synchronous pass. Generating rivers therefore never moves cities after the
 * fact: there is no async debounce and no "rivers finished → drop the feature cache" invalidation. The
 * feature cache simply keys on the river network it was built from, so a NEW network re-derives the
 * features once, declaratively — the coupling lives in the cache key, not in a hand-written delete.
 *
 * Both caches key on the base GlobeMap (a regen → a new map object → fresh derivations) plus the live
 * dials that actually affect each: rivers on the seed + terrain + routing dials; features on sea level
 * + language + the river network. Cheap on steady-state frames (cache hits); only discrete events (a
 * new map, a debounced dial change) recompute. No DOM / WebGL here — the module is unit-testable with a
 * fake sampler + plain GlobeMap.
 */
export type MapDerivations = {
  rivers(baseMap: GlobeMap): RiverData;
  features(baseMap: GlobeMap): MapFeatures;
  // The cached features WITHOUT forcing a compute — for the hover overlay, which only runs while the
  // country layer (hence a prior features() this frame) is live. Null if nothing's cached yet.
  peekFeatures(baseMap: GlobeMap): MapFeatures | null;
  // Drop the feature cache for a base map: a feature-only dial (CITY / POPULATION / COUNTRY) changed,
  // which touches neither the river network nor the terrain, so only cities/countries re-derive.
  invalidateFeatures(baseMap: GlobeMap): void;
};

export function createMapDerivations(deps: MapDerivationsDeps): MapDerivations {
  type RiverEntry = { sig: string; rivers: RiverData };
  type FeatureEntry = { seaLevel: number; language: Language; rivers: RiverData; result: MapFeatures };
  const riverCache = new WeakMap<GlobeMap, RiverEntry>();
  const featureCache = new WeakMap<GlobeMap, FeatureEntry>();

  // Everything the routed network depends on. Draw-time dials (WIDTH_* / ZOOM_REVEAL) are deliberately
  // absent — they only affect stroking, not routing. paramsKey covers terrain shape AND sea level.
  const riverSignature = (): string => {
    const { mapSeed, paramsKey } = deps.view();
    return [
      mapSeed, paramsKey,
      RIVERS.MIN_DRAINAGE.value, RIVERS.MOISTURE_WEIGHT.value, RIVERS.SOURCE_MOISTURE.value,
      RIVERS.WATER_SCALING.value, RIVERS.ROUGHNESS.value, RIVERS.BRANCHING.value,
      RIVERS.MEANDER.value, RIVERS.MEANDER_DETAIL.value,
    ].join("|");
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

  const features = (baseMap: GlobeMap): MapFeatures => {
    const seaLevel = OCEANS.SEA_LEVEL.value;
    const { mapSeed, language, languagePool } = deps.view();
    const riverData = rivers(baseMap); // RIVERS FIRST — cities snap to the final network, placed once
    const cached = featureCache.get(baseMap);
    if (cached && cached.seaLevel === seaLevel && cached.language === language && cached.rivers === riverData) {
      return cached.result;
    }
    const result = computeMapFeatures(
      baseMap, seaLevel, language, mapSeed, deps.featureNamer, languagePool, snapshotParams(), riverData
    );
    featureCache.set(baseMap, { seaLevel, language, rivers: riverData, result });
    return result;
  };

  return {
    rivers,
    features,
    peekFeatures: (baseMap) => featureCache.get(baseMap)?.result ?? null,
    invalidateFeatures: (baseMap) => void featureCache.delete(baseMap),
  };
}
