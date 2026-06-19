import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

export interface MapSettings {
  resolution: number;
  seaLevel: number;
  zoom: number; // 0 = whole planet, 1 = max zoom toward a patch
  theme: Theme;
}

export type NumericSettingKey = Exclude<keyof MapSettings, "theme">;

export const MAP_DEFAULTS: MapSettings = {
  resolution: 1,
  seaLevel: 0.5,
  zoom: 0,
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
  OCTAVES: 6, // more = finer detail, costlier
  GAIN: 0.7, // amplitude falloff per octave; higher = rougher
  LACUNARITY: 2, // wavelength shrink per octave
} as const;

// CONTINENT — carrier wave: decides land vs water, then a shaping curve maps it
// to a base height (abyss → shelf edge → inland).
export const CONTINENT = {
  WAVELENGTH: [1.5, 2.5], // larger = bigger, fewer continents
  // Domain-warp strength (higher = more organic, wandering coasts), VARIED across the
  // map [min..max] by a very-low-frequency wave so some regions are wavier than others.
  WARP: [0.45, 0.65],
  WARP_VAR_WAVELENGTH: 1, // wavelength of that wave; larger = broader warp regions (lower freq)
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
  NOISE_OFFSET: 31.7, // decorrelates the moisture noise from the elevation field
} as const;

// ICE — polar snow caps on LAND (open water doesn't ice, for now). Land is snow poleward
// of its snow line (EXTENT − LAND_BONUS, in |y| = sin latitude), blended back into the
// terrain over EDGE on the equatorward side. The line is RUFFLEd by noise (a base wave
// for a slightly lopsided cap + a finer octave at 3× for a ragged edge) so it isn't a
// clean circle. ASYMMETRY tweaks each pole. (EXTENT near 1 = tiny caps; lower for bigger.)
export const ICE = {
  EXTENT: [0.85, 0.92], // |y| poleward of which land is iced; higher = smaller caps
  ASYMMETRY: [-0.03, 0.03], // per-pole tweak around the shared extent
  LAND_BONUS: 0.08, // ice reaches this much farther toward the equator over land
  EDGE: 0.04, // width (in |y|) of the soft equatorward blend; smaller = crisper edge
  RUFFLE: 0.035, // how far the snow line wanders (|y|) → asymmetrical, ragged edge
  RUFFLE_FREQ: 4, // base scale of the ruffle (a finer octave at 3× rides on top)
  // Lower-lying land "pokes through" the ice (shows terrain) toward the equator, then
  // fades to solid a little before each pole. Toward the equator only land above
  // LAND_THRESHOLD ices (lower land shows green); approaching a pole the threshold drops
  // to POLE_THRESHOLD (≈ sea level → all land ices) over SOLID_FADE, fully solid by SOLID_LAT.
  LAND_THRESHOLD: 0.5, // equatorward: land below this pokes through (shows terrain)
  POLE_THRESHOLD: 0.48, // near a pole: ice all land down to ~sea level (no poke-through)
  SOLID_LAT: 0.95, // |y| at/after which the cap is fully solid — "a little before the pole"
  SOLID_FADE: 0.12, // |y| span over which the poke-through fades out approaching SOLID_LAT
} as const;

// FEATURE_DETAIL — "erosion": a low-frequency wave that scales the COAST/MOUNTAIN
// relief amplitude between smooth and rugged regions within one map.
export const FEATURE_DETAIL = {
  WAVELENGTH: [0.8, 1.5], // larger = broader smooth/rugged zones (per seed)
  AMPLITUDE: [0.5, 0.7], // FEATURE amplitude [smooth zones, rugged zones]; raise hi for taller/more mountains
} as const;

// Midpoint of the FEATURE_DETAIL amplitude; dividing by it gives a ~1-centered factor
// used to modulate moisture (more wet/dry swing in rugged regions, less in calm ones).
export const FEATURE_DETAIL_MID =
  (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;

// Per-seed wet/dry bias applied at render time (not a wave). higher = wetter.
export const RAINFALL = [0.65, 0.8] as const;

// Fixed elevation contrast applied before coloring.
// Higher = more extreme highs/lows → more mountains + deeper ocean, fewer mid zones.
export const ELEVATION_CONTRAST = 0.72;

// Sea level as a waterline in raw-elevation space: slider 0..1 → lerp(MIN, MAX).
// MIN = lots of land; MAX = mostly ocean (land still renders its full bands).
export const SEA_LEVEL = { MIN: 0.12, MAX: 0.82 } as const;

// Stops relief from digging below sea level inland (prevents lakes), so
// amplitude can stay high for tall mountains + jagged coasts. 1 = no inland lakes,
// 0 = lakes everywhere; coasts keep full downward relief (bays) regardless.
export const INLAND_SINK_DAMP = 0.82;

// Point-grid jitter; higher = more irregular cell shapes.
export const JITTER = 0.5;

// Mesh / LOD infrastructure (not terrain shape).
export const MESH = {
  CACHE_CAP: 4, // global Voronoi meshes cached per point count (seed-independent; reused across seeds)
  LOCAL_KEEP_FRACTION: 0.85, // patch cells beyond this fraction of the cap are unbounded padding → dropped
  OCCLUSION_MARGIN_DEG: 3, // inset the patch occlusion cap so a ring of base cells still draws under its rim
} as const;

export const INVARIANTS = {
  NEUTRAL_CENTER_POINT: 0.5, // neutral center for noise fields and midpoint math
} as const;

export function sampleDial(
  range: readonly [number, number],
  rng: () => number
): number {
  return randomContinuousChoice(range[0], range[1], rng);
}
