import { POPULATION } from "../../common/settings";

/**
 * Per-cell HABITABILITY model — terrain → a unitless suitability weight (roughly [0, 1.3]). Summed
 * over a country's land cells, each weighted by area and any coastal bonus, this is the country's
 * carrying capacity, which countries.ts turns into a head count. It REPLACES the old separable
 * latitude × moisture-band × elevation-family step multipliers with ONE joint climate surface.
 *
 * Grounded in ~1400 population geography (see docs / the design brainstorm):
 *  • The human climate niche is BIMODAL in mean annual temperature — a temperate mode (~13 °C) and a
 *    hot monsoon mode (~27 °C) — and has held for ~6000 yrs. We rebuild that curve directly.
 *  • Density ramps steeply with rainfall through the semi-arid band, then saturates; true desert is
 *    near-empty, and perpetually-wet hot lowland (rainforest: leached soil + disease) falls back down.
 *  • Elevation acts THROUGH temperature (the environmental lapse rate): tropical highlands turn
 *    temperate and habitable, temperate peaks turn frigid — so most of the old elevation penalty
 *    drops out for free, leaving only a ruggedness (slope) term for hard-to-farm broken ground.
 *  • Coastal / lakeshore cells carry a trade-and-fishing bonus (pre-modern water transport was ~10×
 *    cheaper than land); applied in countries.ts where the shore distance is known. Rivers: pass 2.
 *
 * NB: with only an ANNUAL moisture field (no seasonality) the hot-wet "monsoon" and "rainforest"
 * regimes can't be told fully apart — we approximate by reserving the rainforest roll-off for the
 * very wettest + hottest cells, leaving merely-wet monsoon farmland dense.
 */

// --- mean annual temperature (°C) -------------------------------------------------------------

// Sea-level MAT by |latitude|: ~27 °C at the equator falling to deep polar cold. The 1.4 exponent
// keeps the tropics broad and steepens the mid-latitudes, tracking Earth's zonal mean (≈14 °C at 40°,
// ≈0 °C at 60°) — which is why the temperate density mode lands around 40°.
const MAT_EQUATOR_C = 27;
const MAT_POLE_C = -25;
const LATITUDE_FALLOFF = 1.4;

// Environmental lapse rate: ground cools ~6.5 °C per 1000 m of elevation. The fraction of a cell's
// display height above sea level × Everest gives metres — the SAME anchor cityStats uses for the
// elevation shown on a city card (kept in sync by hand; this is a deliberate, tiny duplication).
const LAPSE_C_PER_M = 0.0065;
const EVEREST_M = 8849;

/** A land cell's mean annual temperature in °C, from its latitude and (lapse-rate-cooled) elevation.
 *  `reportElevation` is the display height in [0,1]; `seaLevel` is the same waterline the caller uses. */
export function meanAnnualTempC(latDeg: number, reportElevation: number, seaLevel: number): number {
  const a = Math.min(1, Math.abs(latDeg) / 90);
  const sealevelMat = MAT_EQUATOR_C - (MAT_EQUATOR_C - MAT_POLE_C) * a ** LATITUDE_FALLOFF;
  const frac = Math.max(0, (reportElevation - seaLevel) / Math.max(1 - seaLevel, 1e-6));
  return sealevelMat - LAPSE_C_PER_M * frac * EVEREST_M;
}

// --- the joint suitability surface ------------------------------------------------------------

const gauss = (x: number, mu: number, sigma: number): number =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/** Smooth 0→1 Hermite ramp across [edge0, edge1]; clamped flat outside. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 1e-6)));
  return t * t * (3 - 2 * t);
}

// Temperature niche — the bimodal heart of the model. The temperate mode is broad (it covers the
// whole 5–20 °C farming range); the hot monsoon mode only FIRES where it's wet enough to be rice
// country, so hot + dry stays a desert (a trough, not a second peak) rather than reading as crowded.
const TEMPERATE_PEAK_C = 13;
const TEMPERATE_SIGMA = 9;
const MONSOON_PEAK_C = 27;
const MONSOON_SIGMA = 4.5;
const MONSOON_WET_GATE: [number, number] = [0.45, 0.7]; // moisture band that unlocks the hot mode

/** Bimodal temperature suitability: a temperate peak plus a moisture-gated hot (monsoon) peak. */
export function temperatureNiche(matC: number, moisture: number): number {
  const temperate = gauss(matC, TEMPERATE_PEAK_C, TEMPERATE_SIGMA);
  const gate = smoothstep(MONSOON_WET_GATE[0], MONSOON_WET_GATE[1], moisture);
  const monsoon =
    POPULATION.MONSOON_STRENGTH.value * gate * gauss(matC, MONSOON_PEAK_C, MONSOON_SIGMA);
  return Math.max(temperate, monsoon);
}

// Moisture / aridity — steep ramp out of the desert, saturating once well-watered; a small floor
// keeps true desert non-zero (oasis + caravan trade). ARIDITY sharpens (or softens) that collapse.
// Then a rainforest roll-off: only the WETTEST + HOTTEST cells (perpetually-soaked equatorial lowland,
// poor leached soils + disease) shed density — monsoon farmland (merely wet) is left untouched.
const DRY_EDGE = 0.3;
const WET_EDGE = 0.62;
const DESERT_FLOOR = 0.04;
const RAINFOREST_PENALTY = 0.4;
const RAINFOREST_WET: [number, number] = [0.82, 0.97];
const RAINFOREST_HOT: [number, number] = [24, 28];

/** Moisture suitability: desert-floor → well-watered ramp, minus a hot-and-soaked rainforest penalty. */
export function moistureSuitability(moisture: number, matC: number): number {
  const ramp = smoothstep(DRY_EDGE, WET_EDGE, moisture) ** POPULATION.ARIDITY.value;
  const base = DESERT_FLOOR + (1 - DESERT_FLOOR) * ramp;
  const rainforest =
    smoothstep(RAINFOREST_WET[0], RAINFOREST_WET[1], moisture) *
    smoothstep(RAINFOREST_HOT[0], RAINFOREST_HOT[1], matC);
  return base * (1 - RAINFOREST_PENALTY * rainforest);
}

// Ruggedness — steep, broken ground is hard to farm even at a friendly temperature (terraces only go
// so far), so local relief suppresses density ON TOP of the cold high peaks already get via MAT.
const SLOPE_GAIN = 10; // brings raw-elevation slope into a ~0..1 effect; mountains roughly halve density

/** Terrain-ruggedness factor in (0, 1]: 1 on flat ground, falling as the local slope steepens. */
export function ruggednessFactor(slope: number): number {
  return 1 / (1 + POPULATION.RUGGEDNESS.value * SLOPE_GAIN * Math.max(0, slope));
}

const ICE_SUPPRESSION = 0.92; // a full ice cap removes 92% of a cell's habitability

export type CellEnv = {
  latDeg: number;
  reportElevation: number; // [0,1] display height — feeds the lapse-rate temperature
  moisture: number; // [0,1] already-contrasted
  ice: number; // [0,1] polar ice-cap mask
  slope: number; // local max |Δ raw-elevation| to neighbours — ruggedness
};

/** Joint per-cell suitability: temperature niche × moisture × ruggedness × ice suppression. */
export function cellSuitability(env: CellEnv, seaLevel: number): number {
  const matC = meanAnnualTempC(env.latDeg, env.reportElevation, seaLevel);
  return (
    temperatureNiche(matC, env.moisture) *
    moistureSuitability(env.moisture, matC) *
    ruggednessFactor(env.slope) *
    (1 - ICE_SUPPRESSION * env.ice)
  );
}

/** Coastal / lakeshore population multiplier from BFS hops to the nearest water (0 = on the shore).
 *  Pre-modern trade + fishing clustered people on the water; the bonus fades exponentially inland.
 *  A negative distance (no water reached) is neutral. */
export function coastBonus(coastDistHops: number): number {
  if (coastDistHops < 0) return 1;
  return (
    1 + POPULATION.COAST_STRENGTH.value * Math.exp(-coastDistHops / POPULATION.COAST_FALLOFF.value)
  );
}

/** Per-cell local relief: the max absolute raw-elevation difference to any neighbour. O(total edges).
 *  Computed over every cell (water included); only land cells are read by the population sum. */
export function cellSlope(elevation: Float32Array, adjacency: number[][]): Float32Array {
  const slope = new Float32Array(elevation.length);
  for (let i = 0; i < elevation.length; i++) {
    let max = 0;
    for (const nb of adjacency[i]) {
      const d = Math.abs(elevation[i] - elevation[nb]);
      if (d > max) max = d;
    }
    slope[i] = max;
  }
  return slope;
}
