import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

export interface MapSettings {
  resolution: number;
  zoom: number;
  seaLevel: number;
  scale: number;
  theme: Theme;
}

export type NumericSettingKey = Exclude<keyof MapSettings, "theme">;

export const MAP_DEFAULTS: MapSettings = {
  resolution: 0.5,
  zoom: 0,
  seaLevel: 0.5,
  scale: 0.5,
  theme: "lush",
};

// Single source of truth for the setting key lists (derived from MAP_DEFAULTS).
export const MAP_SETTINGS_KEYS = Object.keys(MAP_DEFAULTS) as (keyof MapSettings)[];
export const NUMERIC_SETTING_KEYS = MAP_SETTINGS_KEYS.filter(
  (k): k is NumericSettingKey => k !== "theme"
);

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

/** ================================
 *  TUNING (grouped by subsystem)
 *  ================================ */

// UI slider 0..1 → actual value (via lerp).
export const SLIDER_RANGES = {
  RESOLUTION: [10, 200], // grid cells per axis; higher = finer detail, slower
} as const;

// Sampled once per seed (via sampleDial) for per-map variety.
export const DIALS = {
  FBM_W1: [0.25, 0.45], // elevation detail strength; higher = bumpier terrain
  TERRAIN_FREQ: [0.34, 0.58], // terrain feature scale; larger = bigger, fewer features
  WEATHER_FREQ: [0.28, 0.82], // moisture feature scale; larger = bigger, fewer climate zones
  RAINFALL: [0.45, 0.8], // wet/dry bias applied at render time; higher = wetter
} as const;

// Continentalness mask: a low-frequency, domain-warped field shaped into a base
// height (deep ocean → shelf → inland). One octave; the fractal adds coast detail.
export const CONTINENT = {
  SCALE: 1, // larger = bigger, fewer continents
  WARP: 0.3, // higher = more organic, wandering coastlines
  LO: 0.4, // continentalness below this is ocean; higher = less land
  HI: 0.62, // above this is full inland; wider LO→HI gap = gentler coasts
  OCEAN_FLOOR: 0.08, // base height of deep ocean; lower = deeper seas
  INLAND_HEIGHT: 0.6, // base height of inland; higher = more mountains/snow inland
} as const;

// Fractal (fBm) detail noise — shared by elevation detail and moisture.
export const FRACTAL = {
  OCTAVES: 5, // more = finer detail, costlier
  GAIN: 0.5, // amplitude falloff per octave; higher = rougher, more small features
  LACUNARITY: 2, // frequency growth per octave
} as const;

// Elevation finishing.
export const ELEVATION = {
  DETAIL_AMPLITUDE: 0.5, // how strongly fractal detail perturbs the base height
  CONTRAST_LOW_SEA: 0.45, // contrast at low sea level; higher = more extreme highs/lows
  CONTRAST_HIGH_SEA: 1.0, // contrast at high sea level (higher sea ⇒ more dramatic terrain)
} as const;

// Moisture (drives wet/dry biome coloring).
export const MOISTURE = {
  AMPLITUDE: 0.5, // fractal amplitude; higher = stronger wet/dry swings
  CONTRAST: 0.5, // higher = sharper wet/dry boundaries
} as const;

// Scale (globe ↔ island): exponential zoom on the generation coordinates.
export const SCALE = {
  NEUTRAL: 0.5, // slider value that reproduces 1:1 sampling
  ZOOM_RANGE: 3, // zoom-out factor at globe end (1/this at island)
} as const;

// Point-grid jitter; higher = more irregular cell shapes.
export const JITTER = 0.5;

export const INVARIANTS = {
  NEUTRAL_CENTER_POINT: 0.5, // neutral center for noise fields and midpoint math
} as const;

/** Exponential zoom factor for the scale slider; 1 at SCALE.NEUTRAL. */
export function scaleZoom(scale: number): number {
  const t =
    scale >= SCALE.NEUTRAL
      ? (scale - SCALE.NEUTRAL) / (1 - SCALE.NEUTRAL) // 0..1 toward globe
      : (scale - SCALE.NEUTRAL) / SCALE.NEUTRAL; // -1..0 toward island
  return Math.pow(SCALE.ZOOM_RANGE, t);
}

export function sampleDial(
  range: readonly [number, number],
  rng: () => number
): number {
  return randomContinuousChoice(range[0], range[1], rng);
}
