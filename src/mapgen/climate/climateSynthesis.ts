/**
 * climateSynthesis.ts
 *
 * Sphere-native coordinator for deriving Earth-like monthly climate.
 *
 * Air currents now live in airCurrents.ts.
 * Scalar + vector/sphere helpers live in utils.ts.
 */

import type { Vec3 } from "../../common/3DMath";
import { estimateWindAtSite, type ClimateWind } from "./airCurrents";
import { estimateUpwindOceanExposure01 } from "./oceanExposure";
import type { ClimateWorldSampler, LatitudeFactors, SurfaceState, SyntheticMonthlyClimate, TemperatureState } from "./types";
import {
  clamp,
  clamp01,
  degToRad,
  lerpNumber,
  normalizeVec3,
  smoothstep,
  sphereLatitudeDeg,
  sphereLongitudeDeg,
} from "./utils";

// -------------------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------------------
export type ClimatePointInput = Vec3 & {
  latDeg?: number;
  lonDeg?: number;

  elevationM: number;

  world: ClimateWorldSampler;
  seaLevel: number;

  upwindOceanExposure01?: number;
};

export type ClimateSynthesisSettings = {
  globalTempOffsetC: number;
  globalPrecipMultiplier: number;
  axialTiltDeg: number;
};


export const DEFAULT_CLIMATE_SYNTHESIS_SETTINGS: ClimateSynthesisSettings = {
  globalTempOffsetC: 0,
  globalPrecipMultiplier: 1,
  axialTiltDeg: 23.44,
};

// -------------------------------------------------------------------------------------
// Public coordinator
// -------------------------------------------------------------------------------------

export function synthesizeClimateAtPoint(
  input: ClimatePointInput,
  settings: ClimateSynthesisSettings = DEFAULT_CLIMATE_SYNTHESIS_SETTINGS,
): SyntheticMonthlyClimate {
  const surface = deriveSurface(input);
  const latitude = deriveLatitudeFactors(surface.latDeg, settings);
  const wind = estimateWindAtSite(surface.position);

  const upwindOceanExposure01 =
    input.upwindOceanExposure01 ??
    estimateUpwindOceanExposure01({
      site: surface.position,
      wind,
      seaLevel: input.seaLevel,
      world: input.world,
    });

  const temperature = estimateSurfaceTemperatureC({
    surface,
    latitude,
    globalTempOffsetC: settings.globalTempOffsetC,
  });

  const oceanEvaporation = estimateOceanEvaporation({
    surface,
    temperatureC: temperature.meanAnnualTempC,
    latitude,
  });

  const humidity = estimateAtmosphericHumidity({
    surface,
    wind,
    upwindOceanExposure01,
    oceanEvaporation,
  });

  const annualPrecipMm = estimateAnnualPrecipitationMm({
    surface,
    latitude,
    wind,
    upwindOceanExposure01,
    humidity,
    globalPrecipMultiplier: settings.globalPrecipMultiplier,
  });

  const tempsC = synthesizeMonthlyTemperatures({
    temperature,
    latitude,
    upwindOceanExposure01,
  });

  const precipMm = synthesizeMonthlyPrecipitation({
    annualPrecipMm,
    surface,
    wind,
    upwindOceanExposure01,
  });

  return summarizeMonthlyClimate(tempsC, precipMm);
}

// -------------------------------------------------------------------------------------
// Stage 0: Surface / sphere position / land-ocean state
// -------------------------------------------------------------------------------------

function deriveSurface(input: ClimatePointInput): SurfaceState {
  const position = normalizeVec3({
    x: input.x,
    y: input.y,
    z: input.z,
  });

  const latDeg = input.latDeg ?? sphereLatitudeDeg(position);
  const lonDeg = input.lonDeg ?? sphereLongitudeDeg(position);
  const isOcean = input.world.elevationAt(position) < input.seaLevel;

  return {
    position,
    latDeg,
    lonDeg,
    absLatDeg: Math.abs(latDeg),
    isOcean,
    elevationM: input.elevationM,
  };
}

// -------------------------------------------------------------------------------------
// Stage 1: Solar forcing / latitude
// -------------------------------------------------------------------------------------

function deriveLatitudeFactors(
  latDeg: number,
  settings: ClimateSynthesisSettings,
): LatitudeFactors {
  const absLatDeg = Math.abs(latDeg);
  const lat01 = clamp01(absLatDeg / 90);
  const tiltSeasonality = clamp01(settings.axialTiltDeg / 23.44);

  return {
    absLatDeg,
    lat01,

    /** 1 near equator, 0 near poles. */
    solarIntensity01: Math.cos(degToRad(absLatDeg)),

    /** Low near equator, high near poles. */
    seasonality01: Math.pow(lat01, 1.2) * tiltSeasonality,
  };
}

// -------------------------------------------------------------------------------------
// Stage 2: Surface temperature
// -------------------------------------------------------------------------------------

function estimateSurfaceTemperatureC(args: {
  surface: SurfaceState;
  latitude: LatitudeFactors;
  globalTempOffsetC: number;
}): TemperatureState {
  const seaLevelTempC = 30 - 45 * Math.pow(args.latitude.lat01, 1.35);

  // Standard environmental lapse rate: ~6.5 C / km.
  const lapseRateCPerM = 0.0065;

  // Do not treat ocean depth as below-sea-level land.
  const elevationForTempM = Math.max(0, args.surface.elevationM);

  return {
    meanAnnualTempC:
      seaLevelTempC -
      elevationForTempM * lapseRateCPerM +
      args.globalTempOffsetC,
  };
}

// -------------------------------------------------------------------------------------
// Stage 3: Upwind ocean exposure — lives in oceanExposure.ts (estimateUpwindOceanExposure01)
// -------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------
// Stage 4: Ocean evaporation
// -------------------------------------------------------------------------------------

function estimateOceanEvaporation(args: {
  surface: SurfaceState;
  temperatureC: number;
  latitude: LatitudeFactors;
}): number {
  // TODO:
  // Eventually map-wide:
  // - warm ocean cells produce humidity
  // - cold currents suppress evaporation
  // - wind transports humidity downwind

  if (!args.surface.isOcean) return 0;

  const tempFactor = smoothstep(-5, 30, args.temperatureC);
  const solarFactor = clamp01(args.latitude.solarIntensity01);

  return clamp01(0.65 * tempFactor + 0.35 * solarFactor);
}

// -------------------------------------------------------------------------------------
// Stage 5: Atmospheric humidity
// -------------------------------------------------------------------------------------

function estimateAtmosphericHumidity(args: {
  surface: SurfaceState;
  wind: ClimateWind;
  upwindOceanExposure01: number;
  oceanEvaporation: number;
}): number {
  // TODO:
  // Replace this scalar with true humidity advection:
  //
  // 1. seed humidity over ocean cells
  // 2. move humidity along wind.vector
  // 3. lift air over rising terrain
  // 4. rain out humidity when lifted/cooled
  // 5. keep remaining humidity moving downwind

  const maritimeHumidity = args.surface.isOcean
    ? args.oceanEvaporation
    : args.upwindOceanExposure01;

  const circulationWetness = clamp01(0.5 + 0.5 * args.wind.verticalMotion);

  return clamp01(0.7 * maritimeHumidity + 0.3 * circulationWetness);
}

// -------------------------------------------------------------------------------------
// Stage 6: Annual precipitation
// -------------------------------------------------------------------------------------

function estimateAnnualPrecipitationMm(args: {
  surface: SurfaceState;
  latitude: LatitudeFactors;
  wind: ClimateWind;
  upwindOceanExposure01: number;
  humidity: number;
  globalPrecipMultiplier: number;
}): number {
  const base = 1800 * args.humidity;

  const circulationFactor = clamp(
    0.85 + 0.55 * args.wind.verticalMotion,
    0.15,
    1.5,
  );

  const interiorDryingFactor = args.surface.isOcean
    ? 1
    : lerpNumber(0.35, 1.05, args.upwindOceanExposure01);

  const coldAirSuppression = lerpNumber(
    1,
    0.35,
    smoothstep(65, 90, args.latitude.absLatDeg),
  );

  return Math.max(
    0,
    base *
    circulationFactor *
    interiorDryingFactor *
    coldAirSuppression *
    args.globalPrecipMultiplier,
  );
}

// -------------------------------------------------------------------------------------
// Stage 7: Monthly temperature synthesis
// -------------------------------------------------------------------------------------

function synthesizeMonthlyTemperatures(args: {
  temperature: TemperatureState;
  latitude: LatitudeFactors;
  upwindOceanExposure01: number;
}): number[] {
  const continentality01 = 1 - args.upwindOceanExposure01;

  const latitudeAmpC = lerpNumber(2, 34, args.latitude.seasonality01);
  const continentalAmpMultiplier = lerpNumber(0.55, 1.3, continentality01);
  const seasonalAmpC = latitudeAmpC * continentalAmpMultiplier;

  return Array.from({ length: 12 }, (_, month) => {
    // month 0 = synthetic warm-season peak, not calendar January.
    const seasonal = Math.cos((2 * Math.PI * month) / 12);
    return args.temperature.meanAnnualTempC + seasonalAmpC * seasonal;
  });
}

// -------------------------------------------------------------------------------------
// Stage 8: Monthly precipitation synthesis
// -------------------------------------------------------------------------------------

function synthesizeMonthlyPrecipitation(args: {
  annualPrecipMm: number;
  surface: SurfaceState;
  wind: ClimateWind;
  upwindOceanExposure01: number;
}): number[] {
  const absLat = args.surface.absLatDeg;
  const continentality01 = 1 - args.upwindOceanExposure01;

  const weights = Array.from({ length: 12 }, (_, month) => {
    const seasonal = Math.cos((2 * Math.PI * month) / 12);
    const warmSeason01 = (seasonal + 1) / 2;

    // Tropical/subtropical trade-wind regions tend toward wet warm season.
    if (args.wind.belt === "trade" && absLat < 25) {
      return 0.35 + 1.45 * warmSeason01;
    }

    // Crude Mediterranean tendency: maritime subtropics.
    // TODO: needs west/east coast exposure, not just ocean exposure.
    if (absLat >= 30 && absLat <= 45 && args.upwindOceanExposure01 > 0.55) {
      return 1.45 - 0.85 * warmSeason01;
    }

    // Continental mid-latitudes often have warm-season convection.
    if (absLat >= 35 && absLat <= 60 && continentality01 > 0.55) {
      return 0.75 + 0.65 * warmSeason01;
    }

    return 1;
  });

  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (args.annualPrecipMm * w) / sum);
}

// -------------------------------------------------------------------------------------
// Stage 9: Summary
// -------------------------------------------------------------------------------------

function summarizeMonthlyClimate(
  tempsC: number[],
  precipMm: number[],
): SyntheticMonthlyClimate {
  const annualPrecipMm = precipMm.reduce((a, b) => a + b, 0);

  const summer = [0, 1, 2, 3, 4, 5];
  const winter = [6, 7, 8, 9, 10, 11];

  const pick = (
    months: number[],
    fn: (...values: number[]) => number,
  ): number => fn(...months.map((m) => precipMm[m]));

  return {
    tempsC,
    precipMm,

    meanAnnualTempC: tempsC.reduce((a, b) => a + b, 0) / 12,
    annualPrecipMm,

    warmestMonthC: Math.max(...tempsC),
    coldestMonthC: Math.min(...tempsC),

    driestMonthMm: Math.min(...precipMm),
    wettestMonthMm: Math.max(...precipMm),

    driestSummerMonthMm: pick(summer, Math.min),
    driestWinterMonthMm: pick(winter, Math.min),
    wettestSummerMonthMm: pick(summer, Math.max),
    wettestWinterMonthMm: pick(winter, Math.max),

    monthsAbove10C: tempsC.filter((t) => t >= 10).length,
  };
}
