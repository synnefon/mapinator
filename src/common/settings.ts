import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

export interface MapSettings {
  resolution: number;
  seaLevel: number;
  scale: number; // globe zoom: 1 = whole planet, lower = zoom toward a patch
  theme: Theme;
}

export type NumericSettingKey = Exclude<keyof MapSettings, "theme">;

export const MAP_DEFAULTS: MapSettings = {
  resolution: 1,
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
  POINT_COUNT: [400, 100_000], // total Voronoi cells on the globe; higher = finer, slower
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
  WAVELENGTH: [1.5, 2.5], // larger = bigger, fewer continents
  WARP: [0.55, 0.55], // higher = more organic, wandering coasts
  OCTAVES: 5.5, // carrier octaves; more = more island sizes / richer coasts
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
  WAVELENGTH: [0.5, 0.8], // coarse — broad inland relief; larger = bigger ranges
  AMPLITUDE: [0.3, 0.5], // relief deep inland → mountain height
} as const;

// MOISTURE — drives wet/dry biome coloring.
export const MOISTURE = {
  WAVELENGTH: [0.5, 0.7], // larger = bigger climate zones
  AMPLITUDE: 0.4, // higher = stronger wet/dry swings
  CONTRAST: 0.5, // higher = sharper wet/dry boundaries
} as const;

// ICE — polar caps. EXTENT is the per-seed |y| (latitude) where the caps begin
// (one size shared by both poles); higher = smaller caps. ASYMMETRY lets the two
// poles differ slightly so they aren't identical.
export const ICE = {
  EXTENT: [0.8, 0.92], // |y| where ice starts; higher = smaller caps
  ASYMMETRY: [-0.04, 0.04], // per-pole tweak around the shared extent
  EDGE: 0.08, // softness of the ice → land transition
  WOBBLE: 0.06, // irregularity of the cap edge (ragged coastline)
  FREQ: 2.5, // wobble spatial frequency; higher = more wiggle
} as const;

// FEATURE_DETAIL — "erosion": a low-frequency wave that scales the COAST/MOUNTAIN
// relief amplitude between smooth and rugged regions within one map.
export const FEATURE_DETAIL = {
  WAVELENGTH: [0.8, 1.5], // larger = broader smooth/rugged zones (per seed)
  AMPLITUDE: [0.5, 0.7], // FEATURE amplitude [smooth zones, rugged zones]; raise hi for taller/more mountains
} as const;

// Per-seed wet/dry bias applied at render time (not a wave). higher = wetter.
export const RAINFALL = [0.65, 0.8] as const;

// Fixed elevation contrast applied before coloring (no longer sea-level coupled).
// Higher = more extreme highs/lows → more mountains + deeper ocean, fewer mid zones.
export const ELEVATION_CONTRAST = 0.72;

// Sea level as a waterline in raw-elevation space: slider 0..1 → lerp(MIN, MAX).
// MIN = lots of land; MAX = mostly ocean (land still renders its full bands).
export const SEA_LEVEL = { MIN: 0.12, MAX: 0.82 } as const;

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
