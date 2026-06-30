// Population-keyed settlement vocabulary, shared by the marker subtitle (CityMarkers), the fun-fact wording
// (funFact), and the zoom-reveal ladder (cities). Pure number → {string | number} maps with NO dependency
// on the rest of the feature cluster, so cities.ts / funFact.ts / CityMarkers can all import it without an
// import cycle (cities → cityStats → funFact would otherwise close a loop).

// The size word a settlement goes by, purely by head count (the product-given thresholds). This is the NOUN
// the popup subtitle + every fun fact use — distinct from CityTier (big/medium/small), which sizes the
// marker + gates flavour, and from the zoom-reveal level below.
export type SettlementClass = "hamlet" | "village" | "town" | "city" | "metropolis";

// The FLOOR of the split between the GLOBAL big-city set (assignCities — placed once, shown from the globe
// through mid zoom) and the PATCH-LOCAL tail (regionTowns — grown per region on deep zoom). 5,000 is the
// historian's "city" threshold (Bairoch). The live split is globalCityMinPop() — at/above it shows
// globally, below it is the on-demand tail.
export const GLOBAL_CITY_MIN_POP = 5_000;

// The population density (people/km²) at which the 5,000 floor yields a renderable global count — the ~1400
// land average the model is calibrated to. Used to keep the static big-city marker count bounded as density
// climbs: see globalCityMinPop.
export const CITY_DENSITY_REFERENCE = 2.6;

/** The live global/patch split, scaled with population density. The number of cities ≥ S is ∝ U/S and the
 *  urban total U ∝ density, so holding S = floor·(density/reference) keeps the GLOBAL (static-marker) count
 *  ~constant no matter how dense the world — denser planets simply push more mid-cities into the bounded
 *  patch-local tail while the largest stay global. At/below the reference density it's just the 5k floor. */
export function globalCityMinPop(density: number): number {
  return GLOBAL_CITY_MIN_POP * Math.max(1, density / CITY_DENSITY_REFERENCE);
}

export function settlementClass(population: number): SettlementClass {
  if (population >= 1_000_000) return "metropolis";
  if (population >= 100_000) return "city";
  if (population >= 1_000) return "town";
  if (population >= 100) return "village";
  return "hamlet";
}

// Whole-word "town"/"city" (with an optional possessive "'s"), but NOT closed compounds (townsfolk,
// townspeople) or plurals (towns, cities — which refer to OTHER places), so only the settlement's own
// name-noun is rewritten. Lowercase-only by design: the corpus is all-lowercase house style and the only
// capitalized token, the substituted {country} name, must never match.
const SETTLEMENT_WORD = /\b(?:town|city)('s)?\b/g;

/** Rewrite the generic "town"/"city" in a rendered fun fact to the population-appropriate noun, so a place
 *  of 80 reads as a "hamlet" and one of two million a "metropolis". Possessives keep their "'s". */
export function applySettlementNoun(text: string, population: number): string {
  const noun = settlementClass(population);
  return text.replace(SETTLEMENT_WORD, (_match: string, poss: string | undefined) => noun + (poss ?? ""));
}

// Zoom-reveal ladder: the lowest LOD level a marker shows at, by population — biggest first on the globe,
// the long small-town tail only as you zoom in. Independent of (and finer than) SettlementClass so the
// reveal is gradual instead of dumping every "town" (1k–100k spans four reveal steps) at one zoom. The LOD
// ladder tops out at level 6 (renderer/LodPipeline); capitals are forced to level 1 by the caller.
export function minLevelForPopulation(population: number): number {
  if (population >= 50_000) return 1;
  if (population >= 16_000) return 2;
  if (population >= 5_000) return 3;
  if (population >= 2_000) return 4;
  if (population >= 800) return 5;
  return 6;
}
