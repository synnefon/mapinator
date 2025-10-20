import type { Theme } from "./biomes";

export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  clumpiness: number;
  elevationContrast: number;
  moistureContrast: number;
  theme: Theme;
  terrainFrequency: number;
  weatherFrequency: number;
}

export const NUMERIC_SETTING_KEYS = [
  "resolution",
  "rainfall",
  "jitter",
  "zoom",
  "seaLevel",
  "clumpiness",
  "elevationContrast",
  "moistureContrast",
  "terrainFrequency",
  "weatherFrequency",
] as const;

export type NumericSettingKey = (typeof NUMERIC_SETTING_KEYS)[number];

export const MAP_SETTINGS_KEYS = [
  "resolution",
  "jitter",
  "zoom",
  "rainfall",
  "seaLevel",
  "clumpiness",
  "elevationContrast",
  "moistureContrast",
  "theme",
  "terrainFrequency",
  "weatherFrequency",
] as const satisfies readonly (keyof MapSettings)[];

export const isValidSaveFile = (fileContent: any): boolean => {
  if (!fileContent.seed) {
    alert("save file must contain a seed");
    return false;
  }
  if (!fileContent.mapSettings) {
    alert("save file must contain map settings object");
    return false;
  }
  if (
    typeof fileContent.mapSettings !== "object" ||
    fileContent.mapSettings === null
  ) {
    alert("map settings object must be an object");
    return false;
  }
  for (const k of MAP_SETTINGS_KEYS) {
    if (!(k in fileContent.mapSettings)) {
      alert(`save file must contain ${k} in map settings object`);
      return false;
    }
  }
  return true;
};

export const MAP_DEFAULTS: MapSettings = {
  resolution: 0.5,
  jitter: 0.5,
  zoom: 0,
  terrainFrequency: 0.65,
  weatherFrequency: 0.65,
  rainfall: 0.65,
  seaLevel: 0.51,
  clumpiness: 0.8,
  elevationContrast: 0.7,
  moistureContrast: 0.5,
  theme: "default",
};

export type ElevationSettings = {
  centerDrift: number; // random center offset range
  baseRadius: number; // nominal blob radius
  warpStrength: number; // domain-warp amplitude
  ripple: number; // boundary ripple amplitude
  kWarp: number; // domain-warp frequency
  kRip: number; // ripple frequency
  softness: number; // feather width for smoothstep
  aaRadius: number; // AA sample radius in world units (≈ cell size)
};

export const ELEVATION_SETTINGS_DEFAULTS: ElevationSettings = {
  centerDrift: 0.62,
  baseRadius: 0.35,
  warpStrength: 0.5,
  ripple: 0.5,
  kWarp: 2,
  kRip: 2.2,
  softness: 0.3,
  aaRadius: 0.05,
};
