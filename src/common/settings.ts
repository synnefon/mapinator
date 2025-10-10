import type { theme } from "./biomes";

export type ElevationSettings = {
    centerDrift: number;   // random center offset range
    baseRadius: number;    // nominal blob radius
    warpStrength: number;  // domain-warp amplitude
    ripple: number;        // boundary ripple amplitude
    kWarp: number;         // domain-warp frequency
    kRip: number;          // ripple frequency
    softness: number;      // feather width for smoothstep
    aaRadius: number;      // AA sample radius in world units (≈ cell size)
};

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

export const DEFAULTS: MapSettings = {
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
