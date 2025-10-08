import type { ColorScheme } from "./biomes";


export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  clumpiness: number;
  edgeCurve: number;
  elevationContrast: number;
  colorScheme: ColorScheme;
  noiseScale: number;
}

export const DEFAULTS: MapSettings = {
  resolution: 0.5,
  jitter: 0.5,
  zoom: 0,
  noiseScale: 0.35,
  rainfall: 0.65,
  seaLevel: 0.5,
  clumpiness: 0.9,
  edgeCurve: 0.8,
  elevationContrast: 0.5,
  colorScheme: "default",
};
