import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

/** A per-seed sample range [lo, hi]. Mutable so the advanced-settings panel can retune it. */
export type Range = [number, number];

export interface MapSettings {
  resolution: number;
  zoom: number; // 0 = whole planet, 1 = max zoom toward a patch
  theme: Theme;
}

export type NumericSettingKey = Exclude<keyof MapSettings, "theme">;

export const MAP_DEFAULTS: MapSettings = {
  resolution: 1,
  zoom: 0,
  theme: "lush",
};

// Single source of truth for the setting key lists (derived from MAP_DEFAULTS).
const MAP_SETTINGS_KEYS = Object.keys(MAP_DEFAULTS) as (keyof MapSettings)[];
export const NUMERIC_SETTING_KEYS = MAP_SETTINGS_KEYS.filter(
  (k): k is NumericSettingKey => k !== "theme"
);

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

/* ======================================================================
 *  Globe level-of-detail dials — trade fidelity vs. generation cost.
 *  Tune freely; the LOD ladder (main.ts) and zoom mapping (GlobeRenderer)
 *  are derived from these.
 *  ===================================================================== */
export const LOD = {
  // --- detail ceiling (max / deepest zoom) ---
  FINEST_PATCH_POINTS: 11_000_000, // finest level's point density = max-zoom fidelity; raise = sharper deepest zoom
  FINEST_EXTRA_OCTAVES: 6, // extra fractal octaves at the finest level (fine surface detail)
  MAX_ZOOM_SCALE: 26, // radius multiplier at zoom 1; deeper = finest cells spread over less area = sharper

  // --- when detail kicks in (higher-def earlier) ---
  // Density ramps geometrically from the global mesh (zoom 0) to FINEST_PATCH_POINTS (zoom 1);
  // DETAIL_BIAS bends that curve. >1 = detail appears earlier, 1 = even, <1 = later.
  DETAIL_BIAS: 1,

  // --- ladder shape ---
  COARSEST_PATCH_POINTS: 250_000, // coarsest patch — a gentle step above the global mesh
  DENSITY_STEP_RATIO: 2, // density ratio between levels; smaller = more, finer-spaced bands
  PATCH_PRELOAD_MARGIN: 1.5, // patch cap radius ÷ view radius (pan preload)
  RECENTER_FRACTION: 0.12, // regen when the view center moves this fraction of the cap

  // --- misc ---
  GLOBE_FIT_FRACTION: 0.46, // globe radius ÷ min(canvas w, h) at zoom 0 (whole-globe fit)
  GLOBE_OFFSET_FRACTION: 0.125, // globe nudged right by this fraction of canvas width (room beside the menu)
  MIN_EXPORT_POINTS: 4_000_000, // zoomed-in PNG export density floor
  CUBE_FACE_SIZE: 256, // baked terrain cubemap face resolution; higher = sharper / less blocky, slower one-time bake per seed
} as const;

// Shared fractal shape — used by the COAST, MOUNTAIN, and MOISTURE waves.
export const FRACTAL = {
  OCTAVES: 6, // more = finer detail, costlier
  GAIN: 0.7, // amplitude falloff per octave; higher = rougher
  LACUNARITY: 2, // wavelength shrink per octave
};

// CONTINENT — carrier wave: decides land vs water, then a shaping curve maps it
// to a base height (abyss → shelf edge → inland).
export const CONTINENT = {
  WAVELENGTH: [1.5, 2.5] as Range, // larger = bigger, fewer continents
  // Domain-warp strength (higher = more organic, wandering coasts), VARIED across the
  // map [min..max] by a very-low-frequency wave so some regions are wavier than others.
  WARP: [0.45, 0.65] as Range,
  WARP_VAR_WAVELENGTH: 1, // wavelength of that wave; larger = broader warp regions (lower freq)
  OCTAVES: 6, // carrier octaves; more = more island sizes / richer coasts (was 5.5 ≡ 6 under the old ceil-loop)
  AMPLITUDE: [0.8, 0.8] as Range, // higher = more decisive land/ocean split, sharper coasts
  SHELF: [0.4, 0.62] as Range, // [ocean edge, full inland] continentalness band; wider = gentler coasts
  ABYSS_HEIGHT: 0.0, // floor at deepest ocean (C=0); lower = deeper abyssal plains
  BASE_HEIGHT: [0.08, 0.6] as Range, // [shelf-edge floor, inland] base height; gap = land rises above the shelf
};

// OCEAN — the deep-water relief wave: broad and gentle (abyssal swells) so open
// ocean reads as smoothly deepening water, not noisy seabed. AMPLITUDE is the
// damping knob: low = glassy, higher = rolling swells. Blends into COAST across
// the shelf, so coast jaggedness only shows up near land.
export const OCEAN = {
  WAVELENGTH: [0.3, 0.5] as Range, // broad — large, gentle seabed features
  AMPLITUDE: [0.05, 0.12] as Range, // gentle — keep well below COAST so open water stays smooth
};

// Relief riding on the carrier, as two waves blended by the inland ramp: a fine
// COAST wave at the shore and a coarse MOUNTAIN wave deep inland. Decoupling the
// wavelengths keeps coasts detailed even when the interior uses big, broad
// mountains (and when zoomed in / at high res).
export const COAST = {
  WAVELENGTH: [0.15, 0.25] as Range, // fine — nearshore detail; smaller = finer coast
  AMPLITUDE: [0.4, 0.65] as Range, // relief near shore → jaggedness, bays, nearshore islets
};

export const MOUNTAIN = {
  WAVELENGTH: [0.5, 0.8] as Range, // coarse — broad inland relief; larger = bigger ranges
  AMPLITUDE: [0.3, 0.5] as Range, // relief deep inland → mountain height
};

// MOISTURE — drives wet/dry biome coloring.
export const MOISTURE = {
  WAVELENGTH: [0.7, 0.9] as Range, // larger = bigger climate zones
  AMPLITUDE: 0.6, // higher = stronger wet/dry swings
  CONTRAST: 0.45, // higher = sharper wet/dry boundaries
  NOISE_OFFSET: 31.7, // decorrelates the moisture noise from the elevation field
  // Maritime humidity: max pull of moisture toward wet at the coast, fading to 0 deep inland.
  // 0 = off; 0.25 = up to 25% of the way to fully wet at the shoreline.
  WATER_PROXIMITY_EFFECT: 0.5,
  // Desertification rate: how steeply maritime humidity drops from the coast toward the
  // interior. >1 = deserts ramp in fast just past the coast; 1 = linear; <1 = lingers inland.
  DESERT_STEEPNESS: 2,
  // Water-body SIZE sensitivity for the maritime reach: octaves of the continent carrier used
  // to gauge "big water." Fewer = only large bodies (oceans) project humidity far inland (size
  // matters more); toward CONTINENT.OCTAVES (6) = size barely matters.
  WATER_SIZE_OCTAVES: 1, // (was 0.3 ≡ 1 under the old ceil-loop)
};

// ICE — polar snow caps on LAND (open water doesn't ice, for now). Land is snow poleward
// of its snow line (EXTENT − LAND_BONUS, in |y| = sin latitude), blended back into the
// terrain over EDGE on the equatorward side. The line is RUFFLEd by noise (a base wave
// for a slightly lopsided cap + a finer octave at 3× for a ragged edge) so it isn't a
// clean circle. ASYMMETRY tweaks each pole. (EXTENT near 1 = tiny caps; lower for bigger.)
export const ICE = {
  EXTENT: [0.9, 0.95] as Range, // |y| poleward of which land is iced; higher = smaller caps
  ASYMMETRY: [-0.03, 0.03] as Range, // per-pole tweak around the shared extent
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
};

// FEATURE_DETAIL — "erosion": a low-frequency wave that scales the COAST/MOUNTAIN
// relief amplitude between smooth and rugged regions within one map.
export const FEATURE_DETAIL = {
  WAVELENGTH: [0.8, 1.5] as Range, // larger = broader smooth/rugged zones (per seed)
  AMPLITUDE: [0.5, 0.7] as Range, // FEATURE amplitude [smooth zones, rugged zones]; raise hi for taller/more mountains
};

// Midpoint of the FEATURE_DETAIL amplitude; dividing by it gives a ~1-centered factor
// used to modulate moisture (more wet/dry swing in rugged regions, less in calm ones).
// `let` + recomputed in applyTuning so retuning FEATURE_DETAIL.AMPLITUDE keeps it in sync.
export let FEATURE_DETAIL_MID =
  (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;

// Per-seed wet/dry bias applied at render time (not a wave). higher = wetter.
export const RAINFALL: Range = [0.65, 0.8];

// Fixed elevation contrast applied before coloring. `let` (not const) so it's a live
// binding the advanced panel can retune — and so the bundler can't fold it to a literal.
// Higher = more extreme highs/lows → more mountains + deeper ocean, fewer mid zones.
export let ELEVATION_CONTRAST = 0.72;

// Fixed waterline in raw-elevation space: elevation below it renders as ocean depth,
// above it as land height. Not user-adjustable; this is the former default waterline
// (lerp(0.12, 0.82, 0.5)), kept so maps look unchanged after the sea-level slider's removal.
export const WATERLINE = 0.47;

// Stops relief from digging below sea level inland (prevents lakes), so
// amplitude can stay high for tall mountains + jagged coasts. 1 = no inland lakes,
// 0 = lakes everywhere; coasts keep full downward relief (bays) regardless.
// `let` (live binding) so the advanced panel can retune it (see ELEVATION_CONTRAST).
export let INLAND_SINK_DAMP = 0.82;

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

/* ======================================================================
 *  ADVANCED SETTINGS — runtime tuning of the generation/appearance dials.
 *
 *  The advanced panel exposes every terrain/appearance constant above as a
 *  slider. Each knob is addressed by a dotted PATH ("CONTINENT.SHELF.0",
 *  "FRACTAL.GAIN", "ELEVATION_CONTRAST"). TUNING_SCHEMA is the single source
 *  of truth: the UI is generated from it, and applyTuning() walks it to push
 *  overrides into the live constant objects (mutated by reference, so every
 *  reader — main thread and worker alike — sees the new value at call time).
 *  ===================================================================== */

/** A leaf slider. `scalar` = one value at `path`; `range` = a [lo, hi] pair at
 *  `path`.0 / `path`.1 (two sliders sharing the same bounds). */
type TuningBounds = {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
};
export type TuningField =
  | ({ kind: "scalar" } & TuningBounds)
  | ({ kind: "range" } & TuningBounds);

export type TuningGroup = { title: string; fields: TuningField[] };

// One builder for both kinds — `scalar(...)` / `range(...)` just bind the discriminant.
const field =
  (kind: TuningField["kind"]) =>
  (path: string, label: string, min: number, max: number, step: number): TuningField =>
    ({ kind, path, label, min, max, step } as TuningField);
const scalar = field("scalar");
const range = field("range");

// Bounds are sensible UI travel for each dial — wide enough to explore, not so wide
// the useful zone is a sliver. Defaults always sit inside the range.
export const TUNING_SCHEMA: TuningGroup[] = [
  {
    title: "fractal",
    fields: [scalar("FRACTAL.LACUNARITY", "lacunarity", 1, 4, 0.05)],
  },
  {
    title: "continent",
    fields: [
      range("CONTINENT.WAVELENGTH", "wavelength", 0.5, 5, 0.05),
      range("CONTINENT.WARP", "warp", 0, 1.5, 0.01),
      scalar("CONTINENT.WARP_VAR_WAVELENGTH", "warp variation wavelength", 0.2, 3, 0.05),
      scalar("CONTINENT.OCTAVES", "octaves", 1, 8, 0.5),
      range("CONTINENT.AMPLITUDE", "amplitude", 0, 1.5, 0.01),
      range("CONTINENT.SHELF", "shelf band", 0, 1, 0.01),
      scalar("CONTINENT.ABYSS_HEIGHT", "abyss height", 0, 0.5, 0.01),
      range("CONTINENT.BASE_HEIGHT", "base height", 0, 1, 0.01),
    ],
  },
  {
    title: "ocean",
    fields: [
      range("OCEAN.WAVELENGTH", "wavelength", 0.05, 2, 0.01),
      range("OCEAN.AMPLITUDE", "amplitude", 0, 0.5, 0.005),
    ],
  },
  {
    title: "coast",
    fields: [
      range("COAST.WAVELENGTH", "wavelength", 0.02, 1, 0.01),
      range("COAST.AMPLITUDE", "amplitude", 0, 1.5, 0.01),
    ],
  },
  {
    title: "mountain",
    fields: [
      range("MOUNTAIN.WAVELENGTH", "wavelength", 0.1, 2, 0.01),
      range("MOUNTAIN.AMPLITUDE", "amplitude", 0, 1.5, 0.01),
    ],
  },
  {
    title: "moisture",
    fields: [
      range("MOISTURE.WAVELENGTH", "wavelength", 0.1, 2, 0.01),
      scalar("MOISTURE.AMPLITUDE", "amplitude", 0, 1.5, 0.01),
      scalar("MOISTURE.CONTRAST", "contrast", 0, 1, 0.01),
      scalar("MOISTURE.NOISE_OFFSET", "noise offset", 0, 50, 0.1),
      scalar("MOISTURE.WATER_PROXIMITY_EFFECT", "water proximity effect", 0, 1, 0.01),
      scalar("MOISTURE.DESERT_STEEPNESS", "desert steepness", 0, 5, 0.05),
      scalar("MOISTURE.WATER_SIZE_OCTAVES", "water size octaves", 0, 6, 0.1),
    ],
  },
  {
    title: "ice",
    fields: [
      range("ICE.EXTENT", "extent", 0, 1, 0.01),
      range("ICE.ASYMMETRY", "asymmetry", -0.2, 0.2, 0.005),
      scalar("ICE.LAND_BONUS", "land bonus", 0, 0.5, 0.01),
      scalar("ICE.EDGE", "edge softness", 0, 0.3, 0.005),
      scalar("ICE.RUFFLE", "ruffle", 0, 0.2, 0.005),
      scalar("ICE.RUFFLE_FREQ", "ruffle frequency", 0, 16, 0.5),
      scalar("ICE.LAND_THRESHOLD", "land threshold", 0, 1, 0.01),
      scalar("ICE.POLE_THRESHOLD", "pole threshold", 0, 1, 0.01),
      scalar("ICE.SOLID_LAT", "solid latitude", 0, 1, 0.01),
      scalar("ICE.SOLID_FADE", "solid fade", 0, 0.5, 0.01),
    ],
  },
  {
    title: "feature detail (erosion)",
    fields: [
      range("FEATURE_DETAIL.WAVELENGTH", "wavelength", 0.1, 3, 0.05),
      range("FEATURE_DETAIL.AMPLITUDE", "amplitude", 0, 1.5, 0.01),
    ],
  },
  {
    title: "rainfall",
    fields: [range("RAINFALL", "wet/dry bias", 0, 1, 0.01)],
  },
  {
    title: "elevation contrast",
    fields: [scalar("ELEVATION_CONTRAST", "contrast", 0, 1, 0.01)],
  },
  {
    title: "inland sink damp",
    fields: [scalar("INLAND_SINK_DAMP", "damp", 0, 1, 0.01)],
  },
];

/** A user-supplied override map: dotted path → value. Missing paths use the default. */
export type TuningOverrides = Record<string, number>;

// Every leaf path the schema exposes (range fields expand to `.0` and `.1`).
export const TUNING_PATHS: string[] = TUNING_SCHEMA.flatMap((g) =>
  g.fields.flatMap((f) =>
    f.kind === "range" ? [`${f.path}.0`, `${f.path}.1`] : [f.path]
  )
);

// Object groups reachable by the first path segment. Bare-number dials
// (ELEVATION_CONTRAST, INLAND_SINK_DAMP) are live `let`s, handled in `dial` below.
type NumberGroup = number[] | { [key: string]: number | number[] };
const TUNING_TARGETS: Record<string, NumberGroup> = {
  FRACTAL,
  CONTINENT,
  OCEAN,
  COAST,
  MOUNTAIN,
  MOISTURE,
  ICE,
  FEATURE_DETAIL,
  RAINFALL,
};

/**
 * Live get/set for a dial path (at most `GROUP.KEY.INDEX` deep), so reads and writes share
 * one navigation. Bare-number dials are module `let`s; grouped dials live in mutable
 * objects/arrays (mutated by reference → every reader sees the change at call time).
 */
type Dial = { get(): number; set(v: number): void };
function dial(path: string): Dial {
  if (path === "ELEVATION_CONTRAST")
    return { get: () => ELEVATION_CONTRAST, set: (v) => void (ELEVATION_CONTRAST = v) };
  if (path === "INLAND_SINK_DAMP")
    return { get: () => INLAND_SINK_DAMP, set: (v) => void (INLAND_SINK_DAMP = v) };

  const [g, k, idx] = path.split(".");
  const group = TUNING_TARGETS[g];
  if (Array.isArray(group)) {
    const i = Number(k); // RAINFALL.0 — the group itself is the [lo, hi] array
    return { get: () => group[i], set: (v) => void (group[i] = v) };
  }
  const leaf = group[k];
  if (Array.isArray(leaf)) {
    const i = Number(idx); // CONTINENT.WAVELENGTH.0 — the property is a range array
    return { get: () => leaf[i], set: (v) => void (leaf[i] = v) };
  }
  // FRACTAL.LACUNARITY — a plain numeric property.
  return { get: () => group[k] as number, set: (v) => void (group[k] = v) };
}

// Pristine defaults, snapshot at module load BEFORE any applyTuning mutates the dials.
const TUNING_DEFAULTS: TuningOverrides = Object.fromEntries(
  TUNING_PATHS.map((p) => [p, dial(p).get()])
);

/** Default value for a path (the literal originally declared in this file). */
export function tuningDefault(path: string): number {
  return TUNING_DEFAULTS[path];
}

/**
 * Push a set of overrides into the live constants. Every known path is written to
 * `overrides[path] ?? default`, so dropping an override reverts that dial. Called on
 * both the main thread (render dials) and inside the worker (generation dials).
 */
export function applyTuning(overrides: TuningOverrides): void {
  for (const p of TUNING_PATHS) dial(p).set(overrides[p] ?? TUNING_DEFAULTS[p]);
  // Derived; keep in sync with the (possibly retuned) FEATURE_DETAIL amplitude.
  FEATURE_DETAIL_MID = (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;
}
