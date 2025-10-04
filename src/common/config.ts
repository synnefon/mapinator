export interface MapGenSettings {
    resolution: number;
    jitter: number;
    wavelength: number;
    rainfall: number;
    seaLevel: number;
    shatter: number;    // 0..1, default 1 for current behavior
    edgeCurve: number; // optional, >1 = stronger falloff near edges
}

export const DEFAULTS: MapGenSettings = {
  resolution: 75,
  jitter: 0.5,
  wavelength: 0.4,
  rainfall: 0.5,
  seaLevel: 0.5,
  shatter: 0.5,    // 0..1, default 1 for current behavior
  edgeCurve: 0.8, // optional, >1 = stronger falloff near edges
};
