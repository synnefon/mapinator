export interface MapGenSettings {
  resolution: number;
  jitter: number;
  wavelength: number;
  rainfall: number;
  seaLevel: number;
  shatter: number;
  edgeCurve: number;
  greyScale: boolean;
}

export const DEFAULTS: MapGenSettings = {
  resolution: 75,
  jitter: 0.5,
  wavelength: 0.2,
  rainfall: 0.6,
  seaLevel: 0.5,
  shatter: 0.1,
  edgeCurve: 0.8,
  greyScale: false,
};
