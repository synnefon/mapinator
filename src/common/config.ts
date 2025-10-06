import type { ColorScheme } from "./biomes";


export interface MapGenSettings {
  resolution: number;
  jitter: number;
  wavelength: number;
  rainfall: number;
  seaLevel: number;
  shatter: number;
  edgeCurve: number;
  elevationContrast: number;
  colorScheme: ColorScheme;
}

export const DEFAULTS: MapGenSettings = {
  resolution: 75,
  jitter: 0.5,
  wavelength: 0.2,
  rainfall: 0.68,
  seaLevel: 0.5,
  shatter: 0.1,
  edgeCurve: 0.8,
  elevationContrast: 0.5,
  colorScheme: "default",
};
