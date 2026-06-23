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
} as const;

// HILLSHADE — relief shading baked per cell: a fixed cartographic light over the local
// slope makes mountains read as 3D. Applied as a colour multiply at draw time (≈ free).
export const HILLSHADE = {
  EXAGGERATION: 22, // how strongly the relief slope tilts the normal; higher = more dramatic
  AZIMUTH_DEG: 315, // light compass direction (315 = NW, the cartographic convention)
  ALTITUDE_DEG: 45, // light angle above the horizon
  EPSILON: 0.012, // finite-difference step (radians) for the slope — feature-scale, fixed across LOD
  FLOOR: 0.35, // darkest shade multiplier (lower = deeper valley shadows / more 3D)
};

/* ======================================================================
 *  DIALS — the single source of truth for every tunable group. Each numeric
 *  or [lo, hi] leaf below becomes a slider AUTOMATICALLY: the advanced panel
 *  walks this object, so adding a group (or a dial within one) makes it appear
 *  with no other edit. The section title is the key, humanized. Generation
 *  code imports the groups by their familiar names via the destructuring
 *  re-export just below — the SAME object refs, mutated in place by applyTuning.
 *  ===================================================================== */
export const DIALS = {
  // Shared fractal shape — used by the COAST, MOUNTAIN, and MOISTURE waves.
  FRACTAL: {
    OCTAVES: 4.5, // more = finer detail, costlier
    GAIN: 0.7, // amplitude falloff per octave; higher = rougher
    LACUNARITY: 2, // wavelength shrink per octave
  },

  // CONTINENT — carrier wave: decides land vs water, then a shaping curve maps it
  // to a base height (abyss → shelf edge → inland).
  CONTINENT: {
    OCTAVES: 6, // carrier octaves; more = more island sizes / richer coasts (was 5.5 ≡ 6 under the old ceil-loop)
    WAVELENGTH: [1.8, 2.8] as Range, // larger = bigger, fewer continents
    AMPLITUDE: [0.78, 0.89] as Range, // higher = more decisive land/ocean split, sharper coasts
    BASE_HEIGHT: [0.39, 0.6] as Range, // [shelf-edge floor, inland] base height; lowered so mask-gated plains read green (ranges rise from it)
    // Domain-warp strength (higher = more organic, wandering coasts), VARIED across the
    // map [min..max] by a very-low-frequency wave so some regions are wavier than others.
    WARP: [0.2313, 0.4313] as Range,
    WARP_WAVELENGTH: 1, // wavelength of that wave; larger = broader warp regions (lower freq)
    // Fixed elevation contrast applied before coloring.
    ELEVATION_CONTRAST: 0.6728, // Higher = more extreme highs/lows → more mountains + deeper ocean, fewer mid zones.
    INLAND_SINK_DAMP: 0.9933, // Stops relief from digging below sea level inland (prevents lakes), so amplitude can stay high for tall mountains + jagged coasts. 1 = no inland lakes, 0 = lakes everywhere; coasts keep full downward relief (bays) regardless.
  },

  // OCEAN — the deep-water relief wave: broad and gentle (abyssal swells) so open
  // ocean reads as smoothly deepening water, not noisy seabed. AMPLITUDE is the
  // damping knob: low = glassy, higher = rolling swells. Blends into COAST across
  // the shelf, so coast jaggedness only shows up near land.
  OCEAN: {
    WAVELENGTH: [0.5131, 0.7131] as Range, // broad — large, gentle seabed features
    AMPLITUDE: [0, 0.0671] as Range, // gentle — keep well below COAST so open water stays smooth
    SHELF: [0.474, 0.694] as Range, // [ocean edge, full inland] continentalness band; wider = gentler coasts
    ABYSS_HEIGHT: 0.007, // floor at deepest ocean (C=0); lower = deeper abyssal plains
  },

  // Relief riding on the carrier, as two waves blended by the inland ramp: a fine
  // COAST wave at the shore and a coarse MOUNTAIN wave deep inland. Decoupling the
  // wavelengths keeps coasts detailed even when the interior uses big, broad
  // mountains (and when zoomed in / at high res).
  COAST: {
    WAVELENGTH: [0.2153, 0.3153] as Range, // fine — nearshore detail; smaller = finer coast
    AMPLITUDE: [0.1495, 0.3995] as Range, // relief near shore → jaggedness, bays, nearshore islets
    WATERLINE: 0.47, // fixed waterline in raw-elevation space: elevation below it renders as ocean depth, above it as land height.
  },

  MOUNTAIN_RANGE: {
    // (2) The COARSE region mask — WHERE ranges appear: a low-freq wave gated into distinct massifs
    // separated by (green) plains, so ridges don't blanket all inland. Must be COARSER than the
    // ridge WAVELENGTH above (bigger value = bigger ranges).
    OCTAVES: 3,
    WAVELENGTH: 1.9,
    AMPLITUDE: 1,
    THRESHOLD: 0.7, // raise for rarer, sharper-edged ranges
  },

  MOUNTAIN: {
    // TWO wavelengths. (1) The FINE ridge wave — sharp peaks & ridges WITHIN a range:
    // WAVELENGTH: [0.4, 0.62] as Range, // smaller = finer, more ridges
    WAVELENGTH: 0.5,
    // AMPLITUDE: [0.9, 0.95] as Range, // relief deep inland → mountain height (explorer pick; pinned)
    AMPLITUDE: 0.925,
    VALLEY_BIAS: 0.15, // fraction of amplitude carved DOWN (valleys) vs up (crests)

  },

  // MOISTURE — drives wet/dry biome coloring.
  MOISTURE: {
    WAVELENGTH: [0.8, 1] as Range, // larger = bigger climate zones
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
    // Per-seed wet/dry bias applied at render time (not a wave). higher = wetter.
    RAINFALL: [0.725, 0.875] as Range,
  },

  // ICE — polar snow caps on LAND (open water doesn't ice, for now). Land is snow poleward
  // of its snow line (EXTENT − LAND_BONUS, in |y| = sin latitude), blended back into the
  // terrain over EDGE on the equatorward side. The line is RUFFLEd by noise (a base wave
  // for a slightly lopsided cap + a finer octave at 3× for a ragged edge) so it isn't a
  // clean circle. ASYMMETRY tweaks each pole. (EXTENT near 1 = tiny caps; lower for bigger.)
  ICE: {
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
  },

  // FEATURE_DETAIL — "erosion": a low-frequency wave that scales the COAST/MOUNTAIN
  // relief amplitude between smooth and rugged regions within one map.
  FEATURE_DETAIL: {
    WAVELENGTH: [0.8, 1.5] as Range, // larger = broader smooth/rugged zones (per seed)
    AMPLITUDE: [0.5, 0.7] as Range, // FEATURE amplitude [smooth zones, rugged zones]; raise hi for taller/more mountains
  },
};

// Familiar aliases so generation code keeps importing FRACTAL, CONTINENT, … directly — the
// SAME object refs DIALS holds, mutated in place by applyTuning (so every reader stays live).
export const {
  FRACTAL,
  CONTINENT,
  OCEAN,
  COAST,
  MOUNTAIN_RANGE,
  MOUNTAIN,
  MOISTURE,
  ICE,
  FEATURE_DETAIL,
} = DIALS;

// Midpoint of the FEATURE_DETAIL amplitude; dividing by it gives a ~1-centered factor
// used to modulate moisture (more wet/dry swing in rugged regions, less in calm ones).
// `let` + recomputed in applyTuning so retuning FEATURE_DETAIL.AMPLITUDE keeps it in sync.
export let FEATURE_DETAIL_MID =
  (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;

// Fixed waterline in raw-elevation space: elevation below it renders as ocean depth,
// above it as land height. Not user-adjustable; this is the former default waterline
// (lerp(0.12, 0.82, 0.5)), kept so maps look unchanged after the sea-level slider's removal.

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
 *  ADVANCED SETTINGS — runtime tuning of the dials in DIALS.
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

// A group is a string-keyed bag of numeric / [lo, hi] leaves. This view of DIALS is what the
// generic walk (TUNING_SCHEMA) and navigation (dial) iterate.
type DialTarget = Record<string, number | number[]>;
const GROUPS: Record<string, DialTarget> = DIALS;

// Numeric leaves to hide from the panel even though they belong to a group (e.g. a value that
// isn't meant to be tuned by hand). Keyed by dotted path.
const DIAL_OPTOUT = new Set<string>();

// Bounds override hook: dotted path → slider travel, for the rare dial whose derived travel
// (boundsFor) isn't what you want. Empty by default — most dials never need an entry.
const DIAL_BOUNDS: Record<string, { min: number; max: number; step: number }> = {};

// KEY → "key" label / section title (lowercase, underscores → spaces).
const humanize = (key: string): string => key.toLowerCase().replace(/_/g, " ");

const isRange = (v: unknown): v is number[] => Array.isArray(v);

// Round up to a tidy 1 / 2 / 5 × 10ⁿ ceiling; pick a step giving ~100–200 increments.
const niceCeil = (x: number): number => {
  if (x <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const n = x / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const stepFor = (max: number): number =>
  max <= 0.5 ? 0.005 : max <= 2 ? 0.01 : max <= 5 ? 0.05 : max <= 20 ? 0.1 : 0.5;

// Slider travel derived from a dial's own default(s), so a new dial needs only a value to get a
// usable slider: a fraction lands on 0..1, a small value tightens (finer step), a larger value
// gets headroom above its default, and a signed value gets a band symmetric about 0.
function boundsFor(vals: number[]): { min: number; max: number; step: number } {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  if (lo < 0) {
    const m = niceCeil(Math.max(Math.abs(lo), Math.abs(hi)) * 4);
    return { min: -m, max: m, step: stepFor(2 * m) };
  }
  if (hi < 1) {
    if (hi > 0 && hi < 0.25) {
      const max = niceCeil(hi * 4); // small dial → tight band so the travel isn't cramped
      return { min: 0, max, step: stepFor(max) };
    }
    return { min: 0, max: 1, step: 0.01 }; // the common 0..1 fraction
  }
  const max = Math.ceil(hi * 1.5); // larger dial → headroom above the default
  return { min: 0, max, step: stepFor(max) };
}

// One leaf → its TuningField (scalar or range). Bounds: a DIAL_BOUNDS override, else derived
// from the value; label: the humanized key.
function toField(path: string, value: number | number[], key: string): TuningField {
  const kind = isRange(value) ? "range" : "scalar";
  const { min, max, step } =
    DIAL_BOUNDS[path] ?? boundsFor(isRange(value) ? value : [value]);
  return { kind, path, label: humanize(key), min, max, step } as TuningField;
}

// Walk DIALS into the grouped slider schema the panel renders. Section title = humanized key;
// every numeric / range leaf becomes a field (in declaration order), minus DIAL_OPTOUT paths.
export const TUNING_SCHEMA: TuningGroup[] = Object.entries(GROUPS).map(
  ([key, target]) => ({
    title: humanize(key),
    fields: Object.entries(target)
      .map(([k, v]) => toField(`${key}.${k}`, v, k))
      .filter((f) => !DIAL_OPTOUT.has(f.path)),
  })
);

/** A user-supplied override map: dotted path → value. Missing paths use the default. */
export type TuningOverrides = Record<string, number>;

// Every leaf path the schema exposes (range fields expand to `.0` and `.1`).
export const TUNING_PATHS: string[] = TUNING_SCHEMA.flatMap((g) =>
  g.fields.flatMap((f) =>
    f.kind === "range" ? [`${f.path}.0`, `${f.path}.1`] : [f.path]
  )
);

/**
 * Live get/set for a dial path (`GROUP.KEY` or `GROUP.KEY.INDEX`), so reads and writes share
 * one navigation. Every dial lives in a DIALS object (mutated by reference → every reader sees
 * the change at call time).
 */
type Dial = { get(): number; set(v: number): void };
function dial(path: string): Dial {
  const [g, k, idx] = path.split(".");
  const leaf = GROUPS[g][k];
  if (Array.isArray(leaf)) {
    const i = Number(idx); // e.g. CONTINENT.WAVELENGTH.0 — a [lo, hi] range property
    return { get: () => leaf[i], set: (v) => void (leaf[i] = v) };
  }
  // e.g. FRACTAL.LACUNARITY — a plain numeric property.
  return { get: () => GROUPS[g][k] as number, set: (v) => void (GROUPS[g][k] = v) };
}

// Pristine defaults, snapshot at module load BEFORE any applyTuning mutates the dials.
const TUNING_DEFAULTS: TuningOverrides = Object.fromEntries(
  TUNING_PATHS.map((p) => [p, dial(p).get()])
);

/** Default value for a path (the literal originally declared in DIALS). */
export function tuningDefault(path: string): number {
  return TUNING_DEFAULTS[path];
}

/**
 * Push a set of overrides into the live dials. Every known path is written to
 * `overrides[path] ?? default`, so dropping an override reverts that dial. Called on
 * both the main thread (render dials) and inside the worker (generation dials).
 */
export function applyTuning(overrides: TuningOverrides): void {
  for (const p of TUNING_PATHS) dial(p).set(overrides[p] ?? TUNING_DEFAULTS[p]);
  // Derived; keep in sync with the (possibly retuned) FEATURE_DETAIL amplitude.
  FEATURE_DETAIL_MID = (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;
}
