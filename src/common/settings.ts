import type { theme } from "./biomes";


export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  clumpiness: number;
  edgeCurve: number;
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
  edgeCurve: 0.8,
  elevationContrast: 0.7,
  moistureContrast: 0.5,
  theme: "default",
};
