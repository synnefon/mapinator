import type { theme } from "./biomes";

export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  clumpiness: number;
  elevationContrast: number;
  moistureContrast: number;
  theme: theme;
  terrainFrequency: number;
  weatherFrequency: number;
}

const MAP_SETTINGS_KEYS = [
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

export const isMapSettings = (settings: any): settings is MapSettings => {
  if (typeof settings !== "object" || settings === null) return false;
  return MAP_SETTINGS_KEYS.every((k) => k in settings);
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
