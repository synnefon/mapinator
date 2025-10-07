import type { ColorScheme } from "./biomes";


export interface MapGenSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  fisheye: number;
  edgeCurve: number;
  elevationContrast: number;
  colorScheme: ColorScheme;
}

export const DEFAULTS: MapGenSettings = {
  resolution: 0.5,
  jitter: 0.5,
  zoom: 0.2,
  rainfall: 0.68,
  seaLevel: 0.5,
  fisheye: 0.9,
  edgeCurve: 0.8,
  elevationContrast: 0.5,
  colorScheme: "default",
};
