import type { Theme } from "./biomes";

/** A per-seed sample range [lo, hi]. Mutable so the advanced-settings panel can retune it. */
export type Range = [number, number];

/** A tunable dial: its live value co-located with the hover doc and (optionally) explicit slider
 *  bounds. One descriptor is the single source for the value (generation snapshot), the panel
 *  tooltip (DIAL_DOCS), the slider travel (min/max/step, else derived), and the /tune rewrite. */
export type Dial = {
  value: number; doc: string; min?: number; max?: number; step?: number; hidden?: boolean
};
export type DialRange = {
  value: Range; doc: string; min?: number; max?: number; step?: number; hidden?: boolean
};

export interface MapSettings {
  resolution: number;
  zoom: number; // 0 = whole planet, 1 = max zoom toward a patch
  theme: Theme;
  viewPlates?: boolean; // render overlay: colour cells by tectonic plate instead of biome (no regen). Optional so the dev harnesses (sweep/explorer) can omit it → no overlay.
  viewLabels?: boolean; // render overlay: draw generated names for the map's features (seas, continents, …). Optional like viewPlates.
  viewCountries?: boolean; // render overlay: dotted red country borders + country names. Optional like viewPlates.
  viewCities?: boolean; // render overlay: clickable city markers (capitals + towns), sized + zoom-gated by tier. Optional like viewPlates.
  viewCountryColors?: boolean; // render overlay: 4-colour choropleth tinting each country (50% opacity). Optional like viewPlates.
  viewRivers?: boolean; // render overlay: blue river polylines, routed downhill on a fine mesh + drawn over the globe. Optional like viewPlates.
}

// Settings whose value is a number — the keys the numeric sliders + URL parsing drive (excludes
// theme and the boolean view toggles, which are handled on their own).
export type NumericSettingKey = {
  [K in keyof MapSettings]-?: MapSettings[K] extends number ? K : never;
}[keyof MapSettings];

/** One toggle in the Layers panel. All metadata is colocated here, including `defaultOn` — the
 *  single source of truth for a layer's default state, read by the panel (sort + reset) AND by the
 *  derived runtime defaults below. A FEATURE flips a generation switch (FEATURES; regen on change);
 *  a VIEW flips a render-overlay MapSettings flag (re-render only). */
export type ViewLayerKey = "viewPlates" | "viewLabels" | "viewCountries" | "viewCities" | "viewCountryColors" | "viewRivers";
export type Layer =
  | { kind: "feature"; key: keyof Features; label: string; doc: string; defaultOn: boolean }
  | { kind: "view"; key: ViewLayerKey; label: string; doc: string; defaultOn: boolean };

/** A layer's default on/off — straight from its colocated `defaultOn`. */
export const layerDefault = (layer: Layer): boolean => layer.defaultOn;

// Source order is logical (features, then view overlays); the panel re-sorts by default (off last).
export const LAYERS: Layer[] = [
  {
    kind: "feature",
    key: "mountains",
    label: "mountains",
    doc: "ridged peaks and their ground swell",
    defaultOn: true,
  },
  {
    kind: "feature",
    key: "climate",
    label: "climate",
    doc: "wet/dry moisture variation and maritime humidity",
    defaultOn: true,
  },
  {
    kind: "feature",
    key: "ice",
    label: "ice caps",
    doc: "polar snow caps on land",
    defaultOn: true,
  },
  {
    kind: "view",
    key: "viewLabels",
    label: "geographic labels",
    doc: "display names for the map's geographic features",
    defaultOn: true,
  },
  {
    kind: "view",
    key: "viewCountries",
    label: "country names",
    doc: "display country borders and names",
    defaultOn: false,
  },
  {
    kind: "view",
    key: "viewCountryColors",
    label: "country choropleth",
    doc: "tint each country a distinct colour",
    defaultOn: false,
  },
  {
    kind: "view",
    key: "viewCities",
    label: "cities",
    doc: "display city markers",
    defaultOn: false,
  },
  {
    kind: "view",
    key: "viewRivers",
    label: "rivers",
    doc: "trace rivers downhill from the highlands to the sea",
    defaultOn: false,
  },
  {
    kind: "view",
    key: "viewPlates",
    label: "tectonic plates",
    doc: "display the tectonic plates used to generate mountain ranges",
    defaultOn: false,
  },
];

// View-overlay flag defaults, derived from LAYERS so `defaultOn` is the single source.
const VIEW_LAYER_DEFAULTS = Object.fromEntries(
  LAYERS.filter((l) => l.kind === "view").map((l) => [l.key, l.defaultOn])
) as Partial<MapSettings>;

export const MAP_DEFAULTS: MapSettings = {
  resolution: 1,
  zoom: 0,
  theme: "lush",
  ...VIEW_LAYER_DEFAULTS,
};

// Single source of truth for the setting key lists (derived from MAP_DEFAULTS).
const MAP_SETTINGS_KEYS = Object.keys(MAP_DEFAULTS) as (keyof MapSettings)[];
export const NUMERIC_SETTING_KEYS = MAP_SETTINGS_KEYS.filter(
  (k): k is NumericSettingKey => typeof MAP_DEFAULTS[k] === "number"
);

/** =====================================================================
 *  GENERATION
 *  Each wave has a WAVELENGTH (feature size) and AMPLITUDE (strength) plus its own fbm
 *  octave stack (OCTAVES/GAIN/LACUNARITY). Some lerped spatially, some fixed (noted inline).
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
  MAX_ZOOM_SCALE: 26, // radius multiplier at zoom 1; deeper = finest cells spread over less area = sharper

  // --- when detail kicks in (higher-def earlier) ---
  // Density ramps geometrically from the global mesh (zoom 0) to FINEST_PATCH_POINTS (zoom 1);
  // DETAIL_BIAS bends that curve. >1 = detail appears earlier, 1 = even, <1 = later.
  DETAIL_BIAS: 1,

  // --- ladder shape ---
  COARSEST_PATCH_POINTS: 250_000, // coarsest patch — a gentle step above the global mesh
  // Whole-globe GPU overlay density, shown at the zoomed-OUT view (level 0) so its coastline matches
  // the detail patches instead of the coarse base hexes (the "connectivity reverses on zoom" fix).
  // It's a one-time whole-globe mesh (goldbergGlobeOverlayLevel clamps it to ≈ level 7–8), so raising
  // it sharpens the zoomed-out coast at a higher one-time build cost; the base mesh is unaffected.
  GLOBE_OVERLAY_POINTS: 300_000,
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
 *  DIALS — the single source of truth for every tunable group. Each leaf is a Dial / DialRange
 *  descriptor {
      value, doc, optional min/max/step }: the value is what generation snapshots, the
 *  doc is the panel's hover tooltip (DIAL_DOCS), and min/max/step is the slider travel (else derived
 *  from the value via boundsFor). The advanced panel walks this object, so adding a group (or a dial
 *  within one) makes its slider appear with no other edit. The section title is the key, humanized.
 *  Generation reads a resolved snapshot (snapshotParams → TerrainParams), never these objects; the
 *  aliases below feed render-time dials, mutated in place (.value) by applyTuning so readers stay live.
 *  ===================================================================== */
export const DIALS = {
  // Every wave below owns its fbm "octave stack" — OCTAVES (detail layers; more = finer,
  // costlier), GAIN (amplitude falloff per octave; higher = rougher), LACUNARITY (wavelength
  // shrink per octave) — alongside its WAVELENGTH/AMPLITUDE, tuned per wave.

  // Tunables for the political layer (mirrors the DIALS convention; live-editable).
  COUNTRIES: {
    NUM_COUNTRIES: {
      value: 56,
      min: 2,
      max: 80,
      step: 1,
      doc: "how many countries to place (one seed each, always on land)",
    },
    COUNTRY_CLUSTERING: {
      value: 0.74,
      min: 0,
      max: 1,
      step: 0.01,
      doc: "how clustered the countries are: 1 = tightly clustered, 0 = evenly spread",
    },
    CLUSTER_COUNT: {
      value: 7,
      min: 1,
      max: 20,
      step: 1,
      doc: "when clumped, how many separate clusters the countries form",
    },
    WATER_COST: {
      value: 6,
      hidden: true,
      min: 1,
      max: 25,
      step: 0.5,
      doc: "how much harder a border crosses water than land (1 = no harder; higher = countries hug their own landmass)",
    },
    WARP_FREQ: {
      value: 4,
      hidden: true,
      doc: "domain-warp frequency for border wiggle",
    },
    WARP_AMP: {
      value: 1,
      hidden: true,
      doc: "domain-warp strength — higher = more organic, wandering borders",
    },
    BORDER_HOPS: {
      value: 20,
      hidden: true,
      doc: "how far a water body looks out (over water) for its largest bordering country",
    },
  },
  // CITY — placement of city markers within each country (features/cities.ts). Read LIVE (not terrain gen),
  // so a change re-places cities without a full regen. Each country's cities split into four buckets, each
  // placed RIGHT ON its feature so the marker visibly sits there: a RIVER share (on drawn rivers, favouring
  // big ones + their mouths), a SEA share (at a large-water shore — the dominant coastal kind), a LAKE share
  // (at a medium/small-water shore), and the rest sprinkled across the interior. Earth ~1400: rivers the most
  // common settlement water, the SEA a strong second (sea coasts vastly outnumber lake shores), lakes few.
  CITIES: {
    RIVER_FRACTION: {
      value: 0.38,
      min: 0,
      max: 1,
      step: 0.02,
      doc: "share of a country's cities placed ON a drawn river (favouring bigger rivers + their mouths)",
    },
    SEA_FRACTION: {
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.02,
      doc: "share placed at a LARGE-water (sea/ocean) shore — most water-body cities sat here (ports)",
    },
    LAKE_FRACTION: {
      value: 0.07,
      min: 0,
      max: 1,
      step: 0.02,
      doc: "share placed at a MEDIUM/SMALL-water (lake/pond) shore — historically few. The remainder (1 − river − sea − lake) sprinkles across the interior. Earth ~1400 ≈ river .38 / sea .30 / lake .07 / interior .25",
    },
    RIVER_MIN_STRENGTH: {
      value: 0.12,
      min: 0.05,
      max: 0.9,
      step: 0.01,
      doc: "min DRAWN-river flow strength (0–1, 1 = biggest trunk) for a cell to host a river city. The bucket weights by strength so big rivers + mouths win; this is just the floor below which a trickle doesn't count",
    },
    DESERT_AVERSION: {
      value: 0.7,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "how strongly DRY interior land repels cities. The penalty FADES TO NOTHING near a river or coast, so desert ports + oasis towns settle freely — only the deep, waterless interior is shunned (0 = deserts settle like anywhere; 1 = strongest avoidance, but never impossible)",
    },
    ICE_AVERSION: {
      value: 0.8,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "how strongly polar-cap (iced) land repels cities, everywhere including coasts, scaled by how iced the cell is (0 = ice settles like anywhere; 1 = strongest avoidance — a city on the ice stays rare but still possible)",
    },
  },
  // POPULATION — per-cell carrying-capacity model (features/suitability.ts) summed into each country's
  // head count. Read LIVE like COUNTRY/CITY (not part of the terrain snapshot). GLOBAL_POPULATION_DENSITY is
  // the master scale; the rest weight the terrain factors the suitability surface grounds in ~1400 truth.
  // URBAN_FRACTION then splits that head count into city vs. countryside dwellers.
  POPULATION: {
    GLOBAL_POPULATION_DENSITY: {
      value: 2.6,
      min: 0.5,
      max: 20,
      step: 0.5,
      doc: "the whole planet's master population density (people/km² before terrain factors) — the single knob that scales every world's total population up or down; terrain suitability then redistributes it across the land (Earth ~1400 land average ≈ 2.5/km²)",
    },
    COAST_STRENGTH: {
      value: 1.6,
      min: 0,
      max: 5,
      step: 0.1,
      doc: "extra population right on the coast or lakeshore (trade + fishing); 0 = water access doesn't change density",
    },
    COAST_FALLOFF: {
      value: 3,
      min: 1,
      max: 12,
      step: 0.5,
      doc: "how many cells inland the coastal population bonus reaches before fading away",
    },
    MONSOON_STRENGTH: {
      value: 0.55,
      min: 0,
      max: 1.5,
      step: 0.05,
      doc: "weight of the hot-and-wet rice-paddy density mode that makes monsoon lands the most crowded; 0 = temperate climates only",
    },
    ARIDITY: {
      value: 1,
      min: 0.3,
      max: 3,
      step: 0.1,
      doc: "how sharply dry land sheds population toward desert emptiness; higher = a faster collapse just past the well-watered band",
    },
    RUGGEDNESS: {
      value: 1,
      min: 0,
      max: 3,
      step: 0.1,
      doc: "how much steep, broken terrain suppresses farming/population independent of altitude; 0 = slope is ignored",
    },
    URBAN_FRACTION: {
      value: 0.1,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "share of each country's people who live in cities vs. countryside (Earth ~1400 ≈ 0.10); higher = more and larger cities",
    },
  },
  // RIVERS — coarse flow-routed skeleton + grown tributaries + fractal meander (NOT terrain gen, so
  // absent from snapshotParams). The skeleton routes on a FIXED coarse mesh (SKELETON_LEVEL in
  // features/rivers.ts — not a dial); MIN_DRAINAGE/MOISTURE_WEIGHT/BRANCHING/MEANDER* drive the one-time
  // routing (recompute on change); ZOOM_REVEAL/WIDTH_* are read live at draw time. See renderer/rivers.ts.
  RIVERS: {
    MIN_DRAINAGE: {
      value: 10,
      min: 4,
      max: 200,
      step: 2,
      doc: "min upstream cells draining through a point before it seeds a trunk river; lower = more trunks (tributaries are grown separately, see BRANCHING)",
    },
    MOISTURE_WEIGHT: {
      value: 1,
      min: 0,
      max: 1,
      step: 0.1,
      doc: "how much rainfall weights a cell's water yield (0 = every cell equal, 1 = dry cells feed less) → deserts get fewer rivers",
    },
    SOURCE_MOISTURE: {
      value: 0.65,
      min: 0,
      max: 0.9,
      step: 0.05,
      doc: "minimum moisture a cell needs to GENERATE flow — rivers only start in zones at least this wet, then flow freely through drier land. Gentle by default (only true desert is cut); raise to confine sources to the wettest regions. 0 = anywhere",
    },
    WATER_SCALING: {
      value: 0.7,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "how strongly a river's size tracks the water body it drains into (0 = ignore, 1 = full): big seas get big rivers, small lakes get small ones",
    },
    ROUGHNESS: {
      value: 0.02,
      min: 0,
      max: 0.1,
      step: 0.005,
      doc: "fractal micro-relief on the routing height so trunk flow CONVERGES into a dendritic network instead of running parallel down the smooth continental ramp — the key knob against 'lined-up' rivers; too high = chaotic ponding",
    },
    BRANCHING: {
      value: 0.15,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "tributary density grown off the trunks (0 = bare trunks, 1 = dense dendritic network); the small ones surface as you zoom in",
    },
    MEANDER: {
      value: 0.3,
      min: 0,
      max: 0.6,
      step: 0.02,
      doc: "fractal meander amplitude — how much each river wiggles off a straight path",
    },
    MEANDER_DETAIL: {
      value: 3,
      min: 0,
      max: 5,
      step: 1,
      doc: "fractal meander levels; higher = finer wiggle that resolves deeper into zoom (≈ ×2 vertices each)",
    },
    ZOOM_REVEAL: {
      value: 0.1,
      min: 0,
      max: 0.8,
      step: 0.05,
      doc: "how aggressively small tributaries are hidden when zoomed out (0 = always show all; higher = only trunks until you zoom in)",
    },
    WIDTH_MIN: {
      value: 0.2,
      min: 0.2,
      max: 4,
      step: 0.1,
      doc: "thinnest river stroke in px (the smallest channels)",
    },
    WIDTH_MAX: {
      value: 1.5,
      min: 0.5,
      max: 12,
      step: 0.5,
      doc: "thickest river stroke in px at the zoomed-out view (the largest trunk rivers)",
    },
    WIDTH_ZOOM_BOOST: {
      value: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      doc: "how much rivers thicken as you zoom in (0 = fixed px, 1 = grow with the globe)",
    },
  },

  // CONTINENT — carrier wave: decides land vs water, then a shaping curve maps it
  // to a base height (abyss → shelf edge → inland).
  CONTINENTS: {
    OCTAVES: {
      value: 6,
      doc: "carrier octaves; more = more island sizes / richer coasts",
    },
    GAIN: {
      value: 0.56,
      doc: "amplitude falloff per octave; higher = rougher",
    },
    LACUNARITY: {
      value: 2,
      doc: "wavelength shrink per octave",
    },
    WAVELENGTH: {
      value: 1.9,
      doc: "larger = bigger, fewer continents",
    },
    AMPLITUDE: {
      value: 1.9,
      doc: "higher = more decisive land/ocean split, sharper coasts",
    },
    BASE_HEIGHT: {
      value: 0.495,
      doc: "[shelf-edge floor, inland]",
    },
    // NB: land height is capped to just above OCEAN.SEA_LEVEL in ElevationCalculator, so the
    // CONTINENT + COAST surface alone stays green and only the MOUNTAIN wave makes mountains — one
    // variable (SEA_LEVEL) drives both the coastline and that cap. No separate ceiling dial.
    WARP: {
      value: 0.3313,
      doc: "higher = more organic, wandering coasts",
    },
    ELEVATION_CONTRAST: {
      value: 0.6728,
      doc: "higher = more extreme highs/lows → more mountains + deeper ocean, fewer mid zones",
    },
  },

  // OCEAN — the deep-water relief wave: broad and gentle (abyssal swells) so open
  // ocean reads as smoothly deepening water, not noisy seabed. AMPLITUDE is the
  // damping knob: low = glassy, higher = rolling swells. Blends into COAST across
  // the shelf, so coast jaggedness only shows up near land.
  OCEANS: {
    SEA_LEVEL: {
      value: 0.47,
      doc: "elevation below it renders as ocean, above it as land",
    },
    OCTAVES: {
      value: 1,
      doc: "detail layers; more = finer, costlier",
    },
    GAIN: {
      value: 0.7,
      doc: "amplitude falloff per octave; higher = rougher",
    },
    LACUNARITY: {
      value: 2,
      doc: "wavelength shrink per octave",
    },
    WAVELENGTH: {
      value: 0.6131,
      doc: "broad — large, gentle seabed features",
    },
    AMPLITUDE: {
      value: 0.3371,
      doc: "gentle — keep well below COAST so open water stays smooth",
    },
    SHELF: {
      value: [0.474, 0.694] as Range,
      doc: "wider = gentler coasts"
    },
  },

  // Relief riding on the carrier, as two waves blended by the inland ramp: a fine
  // COAST wave at the shore and a coarse MOUNTAIN wave deep inland. Decoupling the
  // wavelengths keeps coasts detailed even when the interior uses big, broad
  // mountains (and when zoomed in / at high res).
  COASTS: {
    OCTAVES: {
      value: 4.5,
      doc: "detail layers; more = finer, costlier",
    },
    GAIN: {
      value: 0.7,
      doc: "amplitude falloff per octave; higher = rougher",
    },
    LACUNARITY: {
      value: 2,
      doc: "wavelength shrink per octave",
    },
    WAVELENGTH: {
      value: 0.2653,
      doc: "fine — nearshore detail; smaller = finer coast",
    },
    AMPLITUDE: {
      value: 0.2745,
      doc: "relief near shore → jaggedness, bays, nearshore islets",
    },
  },

  // TECTONIC — mountain PLACEMENT via fake plate tectonics (replaces the old noise region mask).
  // K plates drift on the sphere; where two CONVERGE, a long, linear range rises along their shared
  // boundary — this is what makes CHAINS instead of round blobs. Only the additive mountain term is
  // placed here; land/water shape is untouched (ocean is gated out by continentalness upstream).
  TECTONICS: {
    PLATE_COUNT: {
      value: 22,
      doc: "number of drifting plates → how many / how long the ranges (more = more, shorter)",
    },
    RANGE_WIDTH: {
      value: 0.33,
      doc: "full angular width (radians) of the mountain belt straddling a boundary",
    },
    SINUOSITY: {
      value: 0.19,
      doc: "how much ranges meander off their straight plate-boundary arcs (0 = dead straight)",
    },
    CONVERGENCE_THRESHOLD: {
      value: 0.04,
      doc: "min collision strength to raise a range; higher = fewer, only the hardest collisions",
    },
    VARIATION: {
      value: 0.73,
      doc: "along-strike height variation — swells, pinches, gaps along a range (0 = uniform ribbon, 1 = full gaps)",
    },
    COAST_BIAS: {
      value: 0.08,
      doc: "fade interior ranges to favor coastal ones; 1 = coast-only, 0 = even across all land",
    },
  },

  // A range = sharp ridged PEAKS on a broad SWELL. The swell's HEIGHT comes from the plate
  // collision itself (the TECTONIC uplift), so harder/closer convergence lifts a taller range;
  // RIDGE_AMPLITUDE is the overall height and SWELL_FRACTION splits it between body and crests.
  MOUNTAINS: {
    OCTAVES: {
      value: 4.5,
      doc: "detail layers on the ridged peaks; more = finer, costlier",
    },
    GAIN: {
      value: 0.84,
      doc: "amplitude falloff per octave; higher = rougher",
    },
    LACUNARITY: {
      value: 1.95,
      doc: "wavelength shrink per octave",
    },
    RIDGE_WAVELENGTH: {
      value: 0.055,
      doc: "spacing of the ridged peaks; SMALLER = MORE peaks packed into a range",
    },
    RIDGE_AMPLITUDE: {
      value: 0.72,
      doc: "overall range height — the collision-driven swell + the crests riding on it",
    },
    SWELL_FRACTION: {
      value: 0.68,
      doc: "body vs crest: broad-swell height as a fraction of the crest rise; higher = more plateau/body, lower = spikier crests + deeper valleys",
    },
  },

  // MOISTURE — drives wet/dry biome coloring.
  MOISTURE: {
    OCTAVES: {
      value: 4.5,
      doc: "detail layers; more = finer, costlier",
    },
    GAIN: {
      value: 0.41,
      doc: "amplitude falloff per octave; higher = rougher",
    },
    LACUNARITY: {
      value: 2.8,
      doc: "wavelength shrink per octave",
    },
    WAVELENGTH: {
      value: 1.55,
      doc: "larger = bigger climate zones",
    },
    AMPLITUDE: {
      value: 0.85,
      doc: "higher = stronger wet/dry swings",
    },
    CONTRAST: {
      value: 0.02,
      doc: "higher = sharper wet/dry boundaries",
    },
    WATER_PROXIMITY_EFFECT: {
      value: 0.29,
      doc: "maritime humidity: max pull of moisture toward wet at the coast, fading to 0 deep inland. 0 = off; 0.25 = up to 25% of the way to fully wet at the shoreline",
    },
    DESERT_STEEPNESS: {
      value: 1.3,
      doc: "desertification rate: how steeply maritime humidity drops from the coast toward the interior. >1 = deserts ramp in fast just past the coast; 1 = linear; <1 = lingers inland",
    },
    WATER_SIZE_OCTAVES: {
      value: 1,
      doc: "water-body SIZE sensitivity for the maritime reach: octaves of the continent carrier used to gauge 'big water'"
    },
    RAINFALL: {
      value: 0.68,
      doc: "higher = wetter",
    },
  },

  // ICE — polar snow caps on LAND (open water never ices). Four levers: COVERAGE (how far toward
  // the equator the caps reach), WOBBLE (how raggedly the snow line wanders), FILL (how completely
  // the cap fills vs leaving low land poking through as holes), and BLEND (how softly the cap edge
  // fades into the surrounding land).
  ICE: {
    COVERAGE: {
      value: 0.04,
      doc: "fraction of each hemisphere (in |sin lat|) the cap reaches; higher = bigger caps",
    },
    WOBBLE: {
      value: 0.07,
      doc: "how far the snow line wanders → ragged, lopsided edge (0 = clean circle)",
    },
    FILL: {
      value: 1.13,
      doc: "how completely the cap fills; higher = fewer holes (ices lower land too)",
    },
    BLEND: {
      value: 0.085,
      doc: "width (in |sin lat|) of the soft fade where the cap meets land; bigger = softer",
    },
  },
};

// Familiar aliases so generation code keeps importing CONTINENT, OCEAN, … directly — the
// SAME object refs DIALS holds, mutated in place by applyTuning (so every reader stays live).
export const {
  COUNTRIES,
  CITIES,
  POPULATION,
  RIVERS,
  CONTINENTS,
  OCEANS,
  COASTS,
  TECTONICS,
  MOUNTAINS,
  MOISTURE,
  ICE,
} = DIALS;

// Mesh / LOD infrastructure (not terrain shape).
export const MESH = {
  CACHE_CAP: 4, // global Voronoi meshes cached per point count (seed-independent; reused across seeds)
  LOCAL_KEEP_FRACTION: 0.85, // patch cells beyond this fraction of the cap are unbounded padding → dropped
  OCCLUSION_MARGIN_DEG: 3, // inset the patch occlusion cap so a ring of base cells still draws under its rim
} as const;

export const INVARIANTS = {
  NEUTRAL_CENTER_POINT: 0.5, // neutral center for noise fields and midpoint math
} as const;

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

// A group is a string-keyed bag of Dial / DialRange descriptors. This view of DIALS is what the
// generic walk (TUNING_SCHEMA, DIAL_DOCS) and navigation (dial) iterate.
type DialLeaf = Dial | DialRange;
const GROUPS: Record<string, Record<string, DialLeaf>> = DIALS;

// KEY → "key" label / section title (lowercase, underscores → spaces).
const humanize = (key: string): string => key.toLowerCase().replace(/_/g, " ");

const isRange = (v: number | Range): v is Range => Array.isArray(v);

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

// One leaf → its TuningField (scalar or range). Bounds: the descriptor's explicit min/max/step when
// all three are set, else derived from the value; label: the humanized key (tooltip → DIAL_DOCS).
function toField(path: string, leaf: DialLeaf, key: string): TuningField {
  const value = leaf.value;
  const kind = isRange(value) ? "range" : "scalar";
  const { min, max, step } =
    leaf.min !== undefined && leaf.max !== undefined && leaf.step !== undefined
      ? { min: leaf.min, max: leaf.max, step: leaf.step }
      : boundsFor(isRange(value) ? value : [value]);
  return { kind, path, label: humanize(key), min, max, step } as TuningField;
}

// Walk DIALS into the grouped slider schema the panel renders. Section title = humanized key;
// every leaf becomes a field (in declaration order).
export const TUNING_SCHEMA: TuningGroup[] = Object.entries(GROUPS)
  .map(([key, target]) => ({
    title: humanize(key),
    // `hidden` dials keep their value and stay live-readable, but never show as sliders.
    fields: Object.entries(target)
      .filter(([, leaf]) => !leaf.hidden)
      .map(([k, leaf]) => toField(`${key}.${k}`, leaf, k)),
  }))
  .filter((group) => group.fields.length > 0);

// Dotted path → hover doc, walked straight off the descriptors. Replaces the old ?raw comment
// parse in AdvancedSettings — the dial's `doc` field is now the single source for its tooltip.
export const DIAL_DOCS: Map<string, string> = new Map(
  Object.entries(GROUPS).flatMap(([g, target]) =>
    Object.entries(target).map(([k, leaf]): [string, string] => [`${g}.${k}`, leaf.doc])
  )
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
type DialAccess = { get(): number; set(v: number): void };
function dial(path: string): DialAccess {
  const [g, k, idx] = path.split(".");
  const leaf = GROUPS[g][k];
  if (Array.isArray(leaf.value)) {
    const arr = leaf.value;
    const i = Number(idx); // e.g. OCEAN.SHELF.0 — one endpoint of a [lo, hi] range dial
    return { get: () => arr[i], set: (v) => void (arr[i] = v) };
  }
  // a plain scalar dial, e.g. CONTINENT.LACUNARITY
  return { get: () => leaf.value as number, set: (v) => void (leaf.value = v) };
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
}

/* ======================================================================
 *  FEATURES — coarse on/off switches for whole terrain features. Each is a plain boolean the
 *  generator branches on via an EARLY EXIT (mountains → skip the MOUNTAIN relief term, leaving
 *  the CONTINENT shape untouched; climate → skip the MOISTURE field, leaving flat moisture;
 *  ice → skip the polar ice caps). Mutated in place like DIALS and synced to the worker on the
 *  `tune` message — NOT pinned dials.
 *  ===================================================================== */
export type Features = { mountains: boolean; climate: boolean; ice: boolean };

/** All features on — the normal planet. */
export const FEATURE_DEFAULTS: Features = Object.fromEntries(
  LAYERS.filter((l) => l.kind === "feature").map((l) => [l.key, l.defaultOn])
) as Features;

/** Live feature switches, read at generation time. Mutated in place; reset via FEATURE_DEFAULTS. */
export const FEATURES: Features = { ...FEATURE_DEFAULTS };

/* ======================================================================
 *  GENERATION PARAMS — a frozen, self-contained snapshot of every tuned value the generator reads,
 *  resolved on the main thread and handed across the worker seam (and to direct callers / tests).
 *  Generation reads ITS params, never the live global dials — so the interface names its whole
 *  dependency and the worker no longer replays applyTuning in its own realm. Render-time dials still
 *  read the aliases above on the main thread. HILLSHADE / MESH / INVARIANTS are fixed constants, not
 *  params, so generation keeps importing them directly.
 *  ===================================================================== */
// Which dial groups cross the worker seam into terrain GENERATION. This ONE list is the single
// source for both the TerrainParams type and snapshotParams below, so a new generation group is a
// single edit (the type + the snapshot derive from it and can't drift out of sync).
//   GENERATION (here, snapshotted to the worker): the terrain-shape + climate fields.
//   RENDER-LIVE (deliberately absent — read straight off the aliases on the main thread):
//     COUNTRY / CITY / POPULATION (the cheap feature layer) and RIVERS (routed on the main thread).
export const GENERATION_GROUPS = {
  CONTINENTS,
  OCEANS,
  COASTS,
  TECTONICS,
  MOUNTAINS,
  MOISTURE,
  ICE,
} as const;
type GenGroups = typeof GENERATION_GROUPS;

export type TerrainParams = {
  [K in keyof GenGroups]: DialValues<GenGroups[K]>;
} & { features: Features };

// The plain-value shape of a descriptor group: each leaf's `.value` (number or Range) — the form
// generation consumes, never the descriptors themselves.
type DialValues<G> = { [K in keyof G]: G[K] extends {
  value: infer V
} ? V : never };
function dialValues<G extends Record<string, DialLeaf>>(group: G): DialValues<G> {
  const out: Record<string, number | Range> = {};
  for (const k in group) {
    const v = group[k].value;
    out[k] = Array.isArray(v) ? ([...v] as Range) : v;
  }
  return out as DialValues<G>;
}

/** Capture the current live dial values + feature switches as a standalone params snapshot. Each
 *  descriptor's `.value` is copied out (ranges deep-copied), so later tuning of the globals can't
 *  mutate a snapshot already handed to the generator. */
export function snapshotParams(): TerrainParams {
  // Iterate the single GENERATION_GROUPS source instead of re-listing groups: adding a group there
  // flows here for free. The one cast bridges the loop's per-key union back to the mapped shape.
  const groups = Object.fromEntries(
    (Object.keys(GENERATION_GROUPS) as (keyof GenGroups)[]).map(
      (key) => [key, dialValues(GENERATION_GROUPS[key])] as const
    )
  ) as { [K in keyof GenGroups]: DialValues<GenGroups[K]> };
  return { ...groups, features: { ...FEATURES } };
}

// (Layer definitions live above MAP_DEFAULTS now — `defaultOn` there is the single source that the
//  derived FEATURE_DEFAULTS + MAP_DEFAULTS view flags read.)
