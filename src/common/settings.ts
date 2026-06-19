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
  resolution: 1,
  zoom: 0,
  seaLevel: 0.5,
  scale: 1,
  theme: "lush",
};

// Single source of truth for the setting key lists (derived from MAP_DEFAULTS).
const MAP_SETTINGS_KEYS = Object.keys(MAP_DEFAULTS) as (keyof MapSettings)[];
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

/** =====================================================================
 *  GENERATION
 *  Each wave has a WAVELENGTH (feature size) and AMPLITUDE (strength), plus
 *  the shared FRACTAL octaves. `[a, b]` tuples are ranges — some sampled per
 *  seed (sampleDial), some lerped spatially, some fixed (noted inline).
 *  ===================================================================== */

// UI slider 0..1 → actual value (via lerp).
export const SLIDER_RANGES = {
  RESOLUTION: [10, 250], // grid cells per axis; higher = finer detail, slower
} as const;

// Shared fractal shape — used by the COAST, MOUNTAIN, and MOISTURE waves.
export const FRACTAL = {
  OCTAVES: 5, // more = finer detail, costlier
  GAIN: 0.7, // amplitude falloff per octave; higher = rougher
  LACUNARITY: 2, // wavelength shrink per octave
} as const;

// CONTINENT — carrier wave: decides land vs water, then a shaping curve maps it
// to a base height (abyss → shelf edge → inland).
export const CONTINENT = {
  WAVELENGTH: [2, 3], // larger = bigger, fewer continents
  WARP: [0.2, 0.55], // higher = more organic, wandering coasts
  OCTAVES: 5, // carrier octaves; more = more island sizes / richer coasts
  AMPLITUDE: [0.8, 0.8], // higher = more decisive land/ocean split, sharper coasts
  SHELF: [0.4, 0.62], // [ocean edge, full inland] continentalness band; wider = gentler coasts
  ABYSS_HEIGHT: 0.0, // floor at deepest ocean (C=0); lower = deeper abyssal plains
  BASE_HEIGHT: [0.08, 0.6], // [shelf-edge floor, inland] base height; gap = land rises above the shelf
} as const;

// OCEAN — the deep-water relief wave: broad and gentle (abyssal swells) so open
// ocean reads as smoothly deepening water, not noisy seabed. AMPLITUDE is the
// damping knob: low = glassy, higher = rolling swells. Blends into COAST across
// the shelf, so coast jaggedness only shows up near land.
export const OCEAN = {
  WAVELENGTH: [0.3, 0.5], // broad — large, gentle seabed features
  AMPLITUDE: [0.05, 0.12], // gentle — keep well below COAST so open water stays smooth
} as const;

// Relief riding on the carrier, as two waves blended by the inland ramp: a fine
// COAST wave at the shore and a coarse MOUNTAIN wave deep inland. Decoupling the
// wavelengths keeps coasts detailed even when the interior uses big, broad
// mountains (and when zoomed in / at high res).
export const COAST = {
  WAVELENGTH: [0.15, 0.25], // fine — nearshore detail; smaller = finer coast
  AMPLITUDE: [0.4, 0.65], // relief near shore → jaggedness, bays, nearshore islets
} as const;

export const MOUNTAIN = {
  WAVELENGTH: [0.8, 1.3], // coarse — broad inland relief; larger = bigger ranges
  AMPLITUDE: [0.3, 0.4], // relief deep inland → mountain height
} as const;

// FEATURE_DETAIL — "erosion": a low-frequency wave that scales the COAST/MOUNTAIN
// relief amplitude between smooth and rugged regions within one map.
export const FEATURE_DETAIL = {
  WAVELENGTH: [0.9, 0.9], // larger = broader smooth/rugged zones (per seed)
  AMPLITUDE: [0.4, 0.7], // FEATURE amplitude [smooth zones, rugged zones]; raise hi for taller/more mountains
} as const;

// MOISTURE — drives wet/dry biome coloring.
export const MOISTURE = {
  WAVELENGTH: [0.28, 0.7], // larger = bigger climate zones
  AMPLITUDE: 0.5, // higher = stronger wet/dry swings
  CONTRAST: 0.5, // higher = sharper wet/dry boundaries
} as const;

// Per-seed wet/dry bias applied at render time (not a wave). higher = wetter.
export const RAINFALL = [0.45, 0.8] as const;

// Elevation contrast [at low sea, at high sea] (not a wave); higher = more extreme.
export const CONTRAST = [0.45, 1.0] as const;

// Stops relief from digging below sea level inland (prevents lakes), so
// amplitude can stay high for tall mountains + jagged coasts. 1 = no inland lakes,
// 0 = lakes everywhere; coasts keep full downward relief (bays) regardless.
export const INLAND_SINK_DAMP = 0.82;

// Globe ↔ island zoom on the generation coordinates (not a wave).
const SCALE = {
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
