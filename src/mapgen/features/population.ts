import { POPULATION } from "../../common/settings";
import type { Government } from "./government";

// Calibrated to Earth circa 1400: world population ≈ 375M (McEvedy & Jones ~350M, Biraben ~374M,
// HYDE ~390M) over ≈149M km² of land ≈ 2.5 people/km² on average. With the per-cell suitability model
// (features/suitability.ts) every terrain factor folds into `effectiveAreaKm2` upstream — the
// suitability-weighted habitable area — so POPULATION.BASE_DENSITY is the single dial that scales a
// world's head count to land near that ~2.5/km² figure. The remaining POPULATION dials weight the
// terrain factors inside the suitability surface; see settings.ts.

export type PopInputs = {
  // Σ over the country's land cells of (cell area km² × cellSuitability × coastBonus): the
  // suitability-weighted habitable area BASE_DENSITY turns into people. Assembled in countries.ts.
  effectiveAreaKm2: number;
  government: Government;
  jitter: number; // 0..1, seeded per country — stands in for everything not yet modelled
};

/** A country's population: master density × its suitability-weighted habitable area, then nudged by
 *  government type and a seeded ±variation. All terrain physics live upstream in effectiveAreaKm2
 *  (features/suitability.ts); this is the final political assembly. */
export function estimatePopulation(p: PopInputs): number {
  const variation = 0.75 + 0.55 * p.jitter; // 0.75–1.30
  const density = POPULATION.BASE_DENSITY.value * p.government.densityFactor * variation;
  return Math.round(p.effectiveAreaKm2 * density);
}
