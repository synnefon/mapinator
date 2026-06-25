import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import type { Government } from "./government";

// A country's inputs to the population estimate. THIS is the extension seam: to fold in a new
// influence (coastline, elevation, moisture, …) add a field here, populate it in countries.ts, and
// add one factor below — no call site changes.
export type PopContext = {
  areaKm2: number;
  latitudeDeg: number;
  government: Government;
  climate: number; // 0..~1.3 mean biome habitability (green dense; desert / ice / mountains sparse)
  jitter: number; // 0..1, seeded per country — stands in for everything not yet modelled
};

// Calibrated to Earth circa 1400: world population ≈ 375M (McEvedy & Jones ~350M, Biraben ~374M,
// HYDE ~390M) over ≈149M km² of land ≈ 2.5 people/km² on average. The factors below average to ≈0.85×
// over a generated map's latitude/biome mix, so a base of 3 lands the realised land average near that
// 2.5/km² figure. This is the single dial to turn to scale every world's population up or down.
export const POPULATION = {
  BASE_DENSITY: 3, // people per km² before factors (Earth ~1400 land average ≈ 2.5 after factors)
};

/** Habitability by |latitude|: temperate bands densest (~40°), tropics moderate, poles sparse. */
export function latitudeHabitability(latDeg: number): number {
  const a = Math.abs(latDeg);
  const temperate = Math.exp(-((a - 40) ** 2) / (2 * 22 * 22)); // peak around 40°
  const tropics = 0.5 * Math.exp(-(a * a) / (2 * 15 * 15)); // a secondary bump near the equator
  return Math.max(0.1, Math.min(1.4, 0.15 + temperate + tropics));
}

// Climate habitability by biome, grounded in ~1400 densities: lush green land (forest / well-watered
// plains) carried the dense farming populations, while deserts, snow-capped mountains, and ice were
// nearly empty. Bands/elevations are the SAME ones the renderer colours by (see terrainClassOf), so the
// "greener → denser" rule tracks the green you actually see on the map.
const MOISTURE_HABITABILITY: Record<MoistureBand, number> = {
  WET: 1.25, // forest / lush — densest
  MID: 0.85, // grassland / temperate plains
  DRY: 0.12, // desert — sparse
};
const ELEVATION_HABITABILITY: Record<ElevationFamily, number> = {
  OCEAN: 0, // never reached (ocean cells classify as null, not land); present to satisfy the record
  LOW: 1.0,
  MEDIUM: 0.9,
  HIGH: 0.4, // rugged uplands
  VERY_HIGH: 0.1, // snow-capped peaks
};

/** Per-land-cell habitability from its drawn biome + polar ice: green → high; desert / mountain / ice
 *  → low. Averaged over a country's cells in countries.ts to form PopContext.climate. */
export function climateHabitability(
  band: MoistureBand,
  elevation: ElevationFamily,
  ice: number
): number {
  return MOISTURE_HABITABILITY[band] * ELEVATION_HABITABILITY[elevation] * (1 - 0.92 * ice);
}

// Density multipliers applied in turn. Each is a small, isolated, testable function of the context.
const POP_FACTORS: ReadonlyArray<{ name: string; multiplier: (c: PopContext) => number }> = [
  { name: "latitude", multiplier: (c) => latitudeHabitability(c.latitudeDeg) },
  { name: "climate", multiplier: (c) => c.climate },
  { name: "government", multiplier: (c) => c.government.densityFactor },
  { name: "variation", multiplier: (c) => 0.75 + 0.55 * c.jitter }, // 0.75–1.30
];

/** Estimate a country's population: base density × area × every factor's multiplier. */
export function estimatePopulation(ctx: PopContext): number {
  let density = POPULATION.BASE_DENSITY;
  for (const factor of POP_FACTORS) density *= factor.multiplier(ctx);
  return Math.round(ctx.areaKm2 * density);
}
