import type { Vec3 } from "../../common/3DMath";

export type SyntheticMonthlyClimate = {
  tempsC: number[];
  precipMm: number[];

  meanAnnualTempC: number;
  annualPrecipMm: number;

  warmestMonthC: number;
  coldestMonthC: number;

  driestMonthMm: number;
  wettestMonthMm: number;

  driestSummerMonthMm: number;
  driestWinterMonthMm: number;
  wettestSummerMonthMm: number;
  wettestWinterMonthMm: number;

  monthsAbove10C: number;
};

export type SurfaceState = {
  position: Vec3;
  latDeg: number;
  lonDeg: number;
  absLatDeg: number;
  isOcean: boolean;
  elevationM: number;
};

export type LatitudeFactors = {
  absLatDeg: number;
  lat01: number;
  solarIntensity01: number;
  seasonality01: number;
};

export type TemperatureState = {
  meanAnnualTempC: number;
};

/**
 * Terrain access at arbitrary sphere points, so climate can look at cells other than the one
 * being classified (upwind ocean fetch, rain-shadow barriers).
 */
export type ClimateWorldSampler = {
  /** Rendered/normalized elevation — `< seaLevel` means ocean. */
  elevationAt(site: Vec3): number;

  /** Climate (report) elevation in meters above sea level — lapse rates and terrain barriers. */
  elevationMAt(site: Vec3): number;
};
