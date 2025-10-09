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
  theme: theme;
  noiseScale: number;
}

export const DEFAULTS: MapSettings = {
  resolution: 0.5,
  jitter: 0.5,
  zoom: 0,
  noiseScale: 0.35,
  rainfall: 0.65,
  seaLevel: 0.51,
  clumpiness: 0.8,
  edgeCurve: 0.8,
  elevationContrast: 0.7,
  theme: "default",
};
