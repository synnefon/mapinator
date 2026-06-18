import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  scale: number;
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
  "scale",
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
  "scale",
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
  seaLevel: 0.5,
  scale: 0.5,
  elevationContrast: 0.7,
  moistureContrast: 0.5,
  theme: "lush",
};

/** ================================
 *  GENERATION CONSTANTS
 *  ================================ */

// Resolution & frequency ranges (slider 0..1 → actual value).
export const RESOLUTION_RANGE: [number, number] = [10, 200];
export const TERRAIN_FREQ_RANGE: [number, number] = [0.1, 1.3];
export const WEATHER_FREQ_RANGE: [number, number] = [0.1, 1.3];

// Moisture.
export const DEFAULT_MOISTURE_CONTRAST = 0.5;
export const WARP_DIVISOR = 4;
export const RIP_DIVISOR = 0.5;
export const FBM_WEIGHTS = { n1: 0.35, n2: 0.15 };

// Elevation contrast, driven by sea level.
export const CONTRAST_AT_LOW_SEA = 0.45;
export const CONTRAST_AT_HIGH_SEA = 1.0;
export const SEA_LEVEL_CONTRAST_MIN = 0.2;
export const SEA_LEVEL_CONTRAST_MAX = 0.9;

// Scale (globe ↔ island): exponential zoom on the generation coordinates.
// At SCALE_NEUTRAL the field is sampled 1:1 (current view). Toward globe the
// sample window widens (more terrain per pixel — denser); toward island it
// narrows (one landmass fills the frame).
export const SCALE_NEUTRAL = 0.5; // slider value that reproduces current terrain
export const SCALE_ZOOM_RANGE = 3; // zoom-out factor at globe end (1/this at island)

/** Exponential zoom factor for the scale slider; 1 at SCALE_NEUTRAL. */
export function scaleZoom(scale: number): number {
  const t =
    scale >= SCALE_NEUTRAL
      ? (scale - SCALE_NEUTRAL) / (1 - SCALE_NEUTRAL) // 0..1 toward globe
      : (scale - SCALE_NEUTRAL) / SCALE_NEUTRAL; // -1..0 toward island
  return Math.pow(SCALE_ZOOM_RANGE, t);
}

// Fractal (fBm) detail noise: octaves spanning many scales so coastal features
// come in a natural range of sizes. Octave 0 amplitude is the per-seed fbmW1.
export const FRACTAL_OCTAVES = 5;
export const FRACTAL_GAIN = 0.5; // amplitude falloff per octave (standard fBm)
export const FRACTAL_LACUNARITY = 2; // frequency growth per octave

// Continentalness (model B): a low-frequency, domain-warped noise field shaped
// into a base height (deep ocean → shelf → inland). The fractal detail rides on
// top, giving wiggly coastlines and a hierarchy of island sizes. Scale-free, so
// it reads as continents when zoomed out and one coastline when zoomed in.
export const CONTINENT_SCALE = 0.99; // larger = bigger, fewer continents
export const CONTINENT_OCTAVES = 3;
export const CONTINENT_GAIN = 0.5;
export const CONTINENT_LACUNARITY = 3;
export const CONTINENT_WARP = 0.1; // domain-warp strength for organic coasts
export const CONTINENT_LO = 0.4; // continentalness below this → deep ocean
export const CONTINENT_HI = 0.62; // above this → full inland
export const OCEAN_FLOOR = 0.08; // base height of deep ocean
export const INLAND_HEIGHT = 0.6; // base inland height before detail
export const DETAIL_AMPLITUDE = 0.5; // how strongly fractal detail perturbs base

/** ================================
 *  DIALS (per-seed sampled ranges)
 *  ================================ */
export const DIALS = {
  // fBm octave-0 amplitude for elevation detail.
  FBM2_W1_RANGE: [0.25, 0.45] as const,

  // Moisture domain-warp strength & frequency.
  WARP_STRENGTH_RANGE: [0.3, 0.7] as const,
  WARP_FREQUENCY_RANGE: [3.5, 4.5] as const,

  // Moisture ripple intensity.
  RIPPLE_INTENSITY_RANGE: [0.4, 0.5] as const,
} as const;

/** ================================
 *  INVARIANTS
 *  ================================ */
export const INVARIANTS = {
  // Neutral center (0.5) for noise fields and midpoint math.
  NEUTRAL_CENTER_POINT: 0.5,
} as const;

export function sampleDial(
  range: readonly [number, number],
  rng: () => number
): number {
  return randomContinuousChoice(range[0], range[1], rng);
}
