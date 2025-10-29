import type { Theme } from "./biomes";
import { randomContinuousChoice } from "./random";

export interface MapSettings {
  resolution: number;
  jitter: number;
  zoom: number;
  rainfall: number;
  seaLevel: number;
  clumpiness: number;
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
  "clumpiness",
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
  "clumpiness",
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
  seaLevel: 0.51,
  clumpiness: 0.8,
  elevationContrast: 0.7,
  moistureContrast: 0.5,
  theme: "default",
};

/** ================================
 *  DIALS
 *  ================================ */
export const DIALS = {
  // Probability distribution for number of ridge lines (mountain ranges/major terrain features).
  // 60% chance of 1 line --> simple terrain with single dominant feature
  // 30% chance of 2 lines --> moderate complexity with crossing/parallel features
  // 10% chance of 3 lines --> complex terrain with multiple intersecting mountain ranges
  LINE_COUNT_PROBS: [
    { val: 1 as const, prob: 0.6 as const },
    { val: 2 as const, prob: 0.3 as const },
    { val: 3 as const, prob: 0.1 as const },
  ],
  // Ridge line length ranges (as fraction of map size), adjusted by line count.
  // Fewer lines --> longer individual features (up to 5x map width for dramatic ranges)
  // More lines --> shorter features (max 1x map width to avoid overcrowding)
  LENGTH_RANGE_BY_COUNT: {
    1: [1, 5] as const, // Single line can span entire map and beyond
    2: [0.5, 2] as const, // Two lines kept moderate to avoid collision
    3: [0.5, 1] as const, // Three lines stay compact for clear definition
  },
  // Ridge line curvature/bend amount, adjusted by line count.
  // Higher values --> more sinuous, winding terrain features
  // Lower values --> straighter, more linear mountain ranges
  // More lines = less individual bend to maintain clarity when features intersect
  BEND_RANGE_BY_COUNT: {
    1: [0.1, 0.32] as const, // Single line can be quite curvy
    2: [0.12, 0.3] as const, // Two lines slightly less curvy
    3: [0.08, 0.3] as const, // Three lines more restrained to avoid chaos
  },

  // Controls randomness in ridge line endpoint placement.
  // Higher values --> endpoints wander more, creating irregular/organic ridge patterns
  // Lower values --> endpoints stay closer to ideal positions, more structured ridges
  ENDPOINT_JITTER_FRACTION_RANGE: [0.15, 0.3] as const,

  // Controls variation in the influence radius of terrain features.
  // Higher values --> features can have much larger/wider areas of influence
  // Lower values --> features are more compact and localized
  RADIUS_JITTER_RANGE: [0.1, 1.3] as const,

  // Bell base: Varies the floor elevation
  // Higher values --> higher baseline plateau, smoother rolling hills, gradual transitions
  // Lower values --> deeper valleys, more dramatic elevation differences, sharper contrasts
  BELL_BASE_RANGE: [0.4, 0.7] as const,

  // Bell gain: Varies the peak elevation added on top
  // Higher values --> more pronounced peaks and valleys, more dramatic terrain
  // Lower values --> flatter terrain with subtle elevation changes
  BELL_GAIN_RANGE: [0.4, 0.63] as const,

  // FBM (Fractional Brownian Motion) weight for primary noise layer.
  // Higher values --> more influence from large-scale terrain features
  // Lower values --> less prominent major terrain formations
  FBM2_W1_RANGE: [0.25, 0.45] as const,

  // FBM weight for secondary (fine detail) noise layer.
  // Higher values --> more surface texture and small-scale detail
  // Lower values --> smoother surfaces with less fine grain
  FBM2_W2_RANGE: [0.14, 0.2] as const,

  // Controls how much terrain features drift/wander from their initial positions.
  // Higher values --> more organic, meandering terrain formations
  // Lower values --> more direct, structured terrain patterns
  CENTER_DRIFT_RANGE: [0.3, 0.7] as const,

  // Base influence radius for terrain features (as fraction of map size).
  // Higher values (0.8) = broader, more sweeping terrain formations
  // Lower values (0.4) = tighter, more localized terrain features
  BASE_RADIUS_RANGE: [0.4, 0.8] as const,

  // Strength of terrain warping/distortion effect.
  // Higher values (0.7) = more dramatic terrain deformation and irregular shapes
  // Lower values (0.3) = subtler warping, shapes closer to original form
  WARP_STRENGTH_RANGE: [0.3, 0.7] as const,

  // Frequency scale for warp noise (higher = more rapid spatial variation).
  // Higher values (4.5) = tight, frequent warping patterns
  // Lower values (3.5) = broad, sweeping warp effects
  WARP_FREQUENCY_RANGE: [3.5, 4.5] as const,

  // Ripple/surface texture intensity (how strong the effect is).
  // Higher values (0.5) = more pronounced surface roughness
  // Lower values (0.4) = smoother surface finish
  RIPPLE_INTENSITY_RANGE: [0.4, 0.5] as const,

  // Ripple noise frequency scale (how fine-grained the texture is).
  // Higher values (2.7) = fine-grained surface texture
  // Lower values (1.7) = coarser ripple patterns
  RIPPLE_FREQUENCY_RANGE: [1.7, 2.7] as const,

  // Edge blending/transition smoothness between terrain features.
  // Higher values (0.7) = softer, more gradual transitions
  // Lower values (0.3) = sharper, more defined feature boundaries
  SOFTNESS_RANGE: [0.3, 0.7] as const,

  // Anti-aliasing sampling radius for edge smoothing (as fraction of map size).
  // Higher values (0.3) = wider smoothing, softer edges
  // Lower values (0.1) = tighter smoothing, crisper edges
  AA_RADIUS_RANGE: [0.1, 0.3] as const,

  RAINFALL_RANGE: [0.45, 0.8] as const,
} as const;

/** =========================================
 *  ADVANCED_DIALS
 *  ========================================= */
export const ADVANCED_DIALS = {
  // Number of initial points when generating ridge line curves (0 to N inclusive).
  // More steps --> smoother initial curve definition, but uses more computation
  CURVE_COARSE_STEPS: 30, // inclusive (0..N)

  // Multi-pass refinement step sizes for smoothing terrain curves.
  // First pass --> coarse smoothing to remove major jaggedness
  // Second pass --> fine smoothing for final polish
  REFINE_STEPS: [0.08, 0.025] as const,

  // Scale factor for coastal terrain influence field.
  // Controls how far inland/offshore the coastal transition zone extends
  // Higher values --> wider coastal gradient zones
  COAST_FIELD_SCALE: 0.52,

  // Cardinal direction offsets [x, y] for sampling neighboring cells.
  // Used for anti-aliasing and edge smoothing: right, left, down, up
  // Enables checking immediate neighbors in 4-connected grid
  AA_CARDINAL_OFFSETS: [
    [1, 0], // right
    [-1, 0], // left
    [0, 1], // down
    [0, -1], // up
  ] as const,
} as const;

/** =================================
 *  INVARIANTS
 *  ================================= */
export const INVARIANTS = {
  // Neutral center point (0.5) used across various noise/terrain calculations.
  // Represents the baseline/no-effect value for:
  // - Warp noise: no terrain displacement
  // - Ripple noise: no surface texture effect
  // - FBM noise: baseline elevation before scaling
  // - Midpoint calculations: exact center between two points
  // Deviations from this center create the actual terrain variations
  NEUTRAL_CENTER_POINT: 0.5,

  // Epsilon (tiny value) for numerical stability in parabola/curve calculations.
  // Prevents division by zero and floating-point precision errors
  PARABOLA_EPS: 1e-6,
} as const;

export function sampleDial(
  range: readonly [number, number],
  rng: () => number
): number {
  return randomContinuousChoice(range[0], range[1], rng);
}
