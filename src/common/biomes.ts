import { clamp } from "./util";
import { mixHex } from "./colorUtils";
import {
  ELEVATION_BAND_BREAKS,
  type ElevationBand,
  type ElevationFamily,
} from "./elevationBands";
// Re-exported so render-side consumers (e.g. BiomeColor) keep importing the band types from here;
// the definitions now live in the neutral common/elevationBands module, shared with generation's
// hillshade gate so generation no longer reaches into this render module for them.
export type { ElevationBand, ElevationFamily };

// ===================== Public Types =====================
export type Theme =
  | "default"
  | "arid"
  | "lush"
  | "rainbow"
  | "oasis"
  | "grayscale"
  // | "winter"
  // | "autumn"
  | "volcano";

export type BiomeKey =
  // water
  | "OCEAN"
  // very high elevation
  | "DRY_VERY_HIGH"
  | "MID_VERY_HIGH"
  | "WET_VERY_HIGH"
  // high elevation
  | "DRY_HIGH"
  | "MID_HIGH"
  | "WET_HIGH"
  // medium elevation
  | "DRY_MEDIUM"
  | "MID_MEDIUM"
  | "WET_MEDIUM"
  // low elevation
  | "DRY_LOW"
  | "MID_LOW"
  | "WET_LOW";

type MoistureBand = "DRY" | "MID" | "WET";

// ===================== Theme → BiomeKey → Hex =====================
export const BiomeColors: Record<Theme, Record<BiomeKey, string>> = {
  default: {
    // ocean
    OCEAN: "#34699A",
    // very high
    DRY_VERY_HIGH: "#bfb9a4",
    MID_VERY_HIGH: "#c4c2bc",
    WET_VERY_HIGH: "#E7E8E9",
    // high
    DRY_HIGH: "#8a816d",
    MID_HIGH: "#85A947",
    WET_HIGH: "#63a947",
    // medium
    DRY_MEDIUM: "#8D8D4E",
    MID_MEDIUM: "#6c8a4e",
    WET_MEDIUM: "#528a4e",
    // low
    DRY_LOW: "#d4c9a1",
    MID_LOW: "#506132",
    WET_LOW: "#436132",
  },
  // 44447a
  arid: {
    // ocean — sun-faded, slightly saline
    OCEAN: "#34699A",
    // very high — rocky, chalky, not icy
    DRY_VERY_HIGH: "#bdb49d", // deeper beige with subtle warmth
    MID_VERY_HIGH: "#bfbeb5", // neutral stone, more shadow separation
    WET_VERY_HIGH: "#c9cccc", // cool chalky tone, stronger definition

    // high — limestone and sage scrub
    DRY_HIGH: "#bbae8c", // more depth in rock tone
    MID_HIGH: "#9ca881", // cool sage with real contrast
    WET_HIGH: "#839d7d", // muted mossy green, tighter value range

    // medium — lighter, drier uplands with sun-baked olive soil
    DRY_MEDIUM: "#b59f70", // richer sun-tan, adds warmth to the slope
    MID_MEDIUM: "#99995f", // clear olive-earth transition
    WET_MEDIUM: "#7b8e61", // restrained sage green, shadowed

    // low — fertile or irrigated basins (richer tones)
    DRY_LOW: "#d0c293", // slightly brighter sand, reflective glare
    MID_LOW: "#96854d", // denser loam brown-green
    WET_LOW: "#637d45", // vibrant floodplain contrast, but still earthy
  },
  lush: {
    // OCEAN: "#44447a",
    OCEAN: "#34699A",

    // very high — scoured gray peaks rising into snow (the brief gray → white at the top).
    DRY_VERY_HIGH: "#b5b0a6", // wind-scoured bare gray rock
    MID_VERY_HIGH: "#dfe2e5", // patchy snow over gray
    WET_VERY_HIGH: "#ffffff", // deep snow

    // high — ABOVE TREELINE: bare rock / scree, brown→tan (forest is below in MEDIUM; snow is
    // above in VERY_HIGH). Real ranges go green→brown→gray→white with elevation, so the rock
    // band is brown regardless of moisture, just damper/darker where wetter.
    DRY_HIGH: "#a98963", // sun-baked tan rock
    MID_HIGH: "#8c6f4f", // brown rock / scree
    WET_HIGH: "#6f5a44", // dark damp rock, sparse alpine

    // medium — dry = tan steppe, wetter = green
    DRY_MEDIUM: "#b59f70", // arid-palette tan
    MID_MEDIUM: "#457339", // deeper tone, mossy undercanopy
    WET_MEDIUM: "#356a33", // saturated jungle floor / wet fern green

    // low — dry = sand desert, wetter = green basin
    DRY_LOW: "#d0c293", // arid-palette sand
    MID_LOW: "#3e6432", // fertile wet ground, near rivers
    WET_LOW: "#27582c", // darkest floodplain, soaked with water
  },
  rainbow: {
    // ocean
    OCEAN: "#44447a",
    // very high
    DRY_VERY_HIGH: "#f9844a",
    MID_VERY_HIGH: "#f3722c",
    WET_VERY_HIGH: "#f94144",
    // high
    DRY_HIGH: "#f9c74f",
    MID_HIGH: "#f9c74f",
    WET_HIGH: "#f8961e",
    // medium
    DRY_MEDIUM: "#4d908e",
    MID_MEDIUM: "#43aa8b",
    WET_MEDIUM: "#90be6d",
    // low
    DRY_LOW: "#577590",
    MID_LOW: "#577590",
    WET_LOW: "#277da1",
  },
  oasis: {
    // ocean
    OCEAN: "#E3D2A6", // same turquoise oasis water

    // very high (oasis ridges / alpine springs)
    DRY_VERY_HIGH: "#E3D2A6", // arid green (dry greenery)
    MID_VERY_HIGH: "#E3D2A6", // vibrant oasis green
    WET_VERY_HIGH: "#04009A", // bright dewy green

    // medium (transition: steppe / shrubland)
    DRY_HIGH: "#E3D2A6", // dry clay and scrub
    MID_HIGH: "#E3D2A6", // dusty khaki
    WET_HIGH: "#4E8F5B", // faded green edge

    // medium (transition: steppe / shrubland)
    DRY_MEDIUM: "#E3D2A6", // dry clay and scrub
    MID_MEDIUM: "#E3D2A6", // dusty khaki
    WET_MEDIUM: "#E3D2A6", // faded green edge

    // low (basins / dunes)
    DRY_LOW: "#E3D2A6", // hot sand
    MID_LOW: "#E3D2A6", // sun-bleached dune
    WET_LOW: "#E3D2A6", // wet sand / muddy wadi
  },
  grayscale: {
    // ocean
    OCEAN: "#2e2d2d", // muted steel grey — subtle water

    // very high
    DRY_VERY_HIGH: "#cccccc", // pale cliff grey
    MID_VERY_HIGH: "#cccccc", // sun-washed light
    WET_VERY_HIGH: "#cccccc", // bright mist white

    // high
    DRY_HIGH: "#a6a6a6", // basalt ridge
    MID_HIGH: "#a6a6a6", // concrete grey
    WET_HIGH: "#a6a6a6", // softened wet tone

    // medium
    DRY_MEDIUM: "#737373", // dry soil
    MID_MEDIUM: "#737373", // neutral midtone
    WET_MEDIUM: "#737373", // lightened by moisture

    // low
    DRY_LOW: "#454444", // dark dune shadow
    MID_LOW: "#454444", // mid shadow tone
    WET_LOW: "#454444", // wet sand / damp wadi
  },
  volcano: {
    // ocean
    OCEAN: "#1E2430",
    // very high
    DRY_VERY_HIGH: "#FF3D00", // lava red
    MID_VERY_HIGH: "#FF3D00", // bright molten orange
    WET_VERY_HIGH: "#FF3D00", // white-hot core / steam vent
    // high
    DRY_HIGH: "#3B2E2B",
    MID_HIGH: "#5C4038",
    WET_HIGH: "#78493C",
    // medium
    DRY_MEDIUM: "#2A2422",
    MID_MEDIUM: "#2A2422",
    WET_MEDIUM: "#2A2422",
    // low
    DRY_LOW: "#1A1A1A",
    MID_LOW: "#1A1A1A",
    WET_LOW: "#1A1A1A",
  },
} as const;

// ===================== Lightness & Theme overrides =====================
export const BASE_LIGHTNESS: Record<ElevationBand, number> = {
  OCEAN_3: -0.06, // deep - darkest
  OCEAN_2: -0.03, // medium depth
  OCEAN_1: 0.01, // shallow
  LOW_1: -0.02,
  LOW_2: 0,
  MEDIUM_1: -0.05,
  MEDIUM_2: 0,
  HIGH_1: -0.05,
  HIGH_2: 0,
  VERY_HIGH_1: -0.05,
  VERY_HIGH_2: 0,
};

// Band centers (midpoint of each band's [prevBreak, break] span) — the x-positions used to turn
// the discrete BASE_LIGHTNESS lookup into a continuous ramp (see bandLightnessAt).
const BAND_CENTERS: { center: number; band: ElevationBand }[] =
  ELEVATION_BAND_BREAKS.map((b, i) => ({
    center: ((i > 0 ? ELEVATION_BAND_BREAKS[i - 1].breakPoint : -1) + b.breakPoint) / 2,
    band: b.band,
  }));

/**
 * The per-band lightness nudge as a CONTINUOUS function of elevation. BASE_LIGHTNESS (merged with
 * any theme override) is a hard per-band lookup, so it steps at every band break — a visible
 * contour line between elevation zones. Interpolating those same values across the band centers
 * turns that square-wave step into a smooth ramp: the gentle within-band shading is kept, but there
 * are no firm lines. `e` is the shaped elevation in [-1, 1] (ocean negative, land [0, 1]).
 */
export function bandLightnessAt(
  e: number,
  lightnessByBand: Record<ElevationBand, number>
): number {
  const first = BAND_CENTERS[0];
  if (e <= first.center) return lightnessByBand[first.band];
  for (let i = 0; i < BAND_CENTERS.length - 1; i++) {
    const lo = BAND_CENTERS[i];
    const hi = BAND_CENTERS[i + 1];
    if (e <= hi.center) {
      const t = (e - lo.center) / (hi.center - lo.center);
      const a = lightnessByBand[lo.band];
      return a + (lightnessByBand[hi.band] - a) * t;
    }
  }
  return lightnessByBand[BAND_CENTERS[BAND_CENTERS.length - 1].band];
}

export type ThemeAdjust = {
  lightness?: Partial<Record<ElevationBand, number>>;
  saturationScale?: number;
};

export const THEME_OVERRIDES: Record<Theme, ThemeAdjust> = {
  default: { saturationScale: 1.0 },
  arid: { saturationScale: 0.95 },
  lush: { saturationScale: 1.07 },
  rainbow: { saturationScale: 1.12 },
  oasis: {
    lightness: {
      OCEAN_3: 0,
      OCEAN_2: 0,
      OCEAN_1: 0,
      LOW_1: 0,
      LOW_2: 0,
      MEDIUM_1: 0,
      MEDIUM_2: 0,
      HIGH_1: 0,
      HIGH_2: 0,
      VERY_HIGH_1: 0,
      VERY_HIGH_2: 0,
    },
    saturationScale: 0.85,
  },
  // winter: { saturationScale: 0.95 },
  // autumn: { saturationScale: 1.12 },
  grayscale: {
    saturationScale: 0.0,
    lightness: {
      OCEAN_3: 0,
      OCEAN_2: 0,
      OCEAN_1: 0,
    },
  },
  volcano: {
    saturationScale: 1.12,
    lightness: {
      OCEAN_3: 0,
      OCEAN_2: 0,
      OCEAN_1: 0,
    },
  },
};

// ===================== Color lookup (blended) =====================
// Family + moisture "stops" at representative positions; the color is bilinearly
// blended between the surrounding stops so biomes transition smoothly instead of
// snapping at band edges. The result is quantized downstream (colorAt) so the
// total palette stays small.
const LAND_FAMILY_STOPS: { family: ElevationFamily; center: number }[] = [
  { family: "LOW", center: 0.11 },
  { family: "MEDIUM", center: 0.37 },
  { family: "HIGH", center: 0.72 }, // brown rock dominates the high ground (pushed up from 0.635)
  { family: "VERY_HIGH", center: 0.95 }, // gray→white snow compressed to the very crests (was 0.875)
];
const MOISTURE_STOPS: { band: MoistureBand; center: number }[] = [
  { band: "DRY", center: 0.1 },
  { band: "MID", center: 0.4 },
  { band: "WET", center: 0.8 },
];

/** Color for a family, blended across the moisture stops. */
const familyMoistureColor = (
  theme: Theme,
  family: ElevationFamily,
  moisture: number
): string => {
  const colorAtBand = (band: MoistureBand) =>
    (BiomeColors[theme][`${band}_${family}` as BiomeKey] ??
      BiomeColors.default[`${band}_${family}` as BiomeKey])!;
  for (let i = 0; i < MOISTURE_STOPS.length - 1; i++) {
    const lo = MOISTURE_STOPS[i];
    const hi = MOISTURE_STOPS[i + 1];
    if (moisture <= hi.center) {
      const t = clamp((moisture - lo.center) / (hi.center - lo.center));
      return mixHex(colorAtBand(lo.band), colorAtBand(hi.band), t);
    }
  }
  return colorAtBand(MOISTURE_STOPS[MOISTURE_STOPS.length - 1].band);
};

export function colorFor(
  theme: Theme,
  elevation: number,
  moisture: number
): string {
  if (elevation < 0) return BiomeColors[theme].OCEAN;
  for (let i = 0; i < LAND_FAMILY_STOPS.length - 1; i++) {
    const lo = LAND_FAMILY_STOPS[i];
    const hi = LAND_FAMILY_STOPS[i + 1];
    if (elevation <= hi.center) {
      const t = clamp((elevation - lo.center) / (hi.center - lo.center));
      return mixHex(
        familyMoistureColor(theme, lo.family, moisture),
        familyMoistureColor(theme, hi.family, moisture),
        t
      );
    }
  }
  const top = LAND_FAMILY_STOPS[LAND_FAMILY_STOPS.length - 1];
  return familyMoistureColor(theme, top.family, moisture);
}

/** Per-theme polar-ice color: matches the theme's snowiest peak (WET_VERY_HIGH). */
export const iceColorFor = (theme: Theme): string =>
  BiomeColors[theme].WET_VERY_HIGH;
