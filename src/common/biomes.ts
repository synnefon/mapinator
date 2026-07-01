import {
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

export type MoistureBand = "DRY" | "MID" | "WET";

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

// ===================== Theme overrides =====================
// Biome colour now comes from the Köppen palette (common/koppen.ts); themes only scale saturation.
export type ThemeAdjust = {
  saturationScale?: number;
};

export const THEME_OVERRIDES: Record<Theme, ThemeAdjust> = {
  default: { saturationScale: 1.0 },
  arid: { saturationScale: 0.95 },
  lush: { saturationScale: 1.07 },
  rainbow: { saturationScale: 1.12 },
  oasis: { saturationScale: 0.85 },
  // winter: { saturationScale: 0.95 },
  // autumn: { saturationScale: 1.12 },
  grayscale: { saturationScale: 0.0 },
  volcano: { saturationScale: 1.12 },
};

// ===================== Family / moisture stops =====================
// Representative positions for the elevation families and moisture bands; terrainClassOf snaps a
// cell's shaped elevation + moisture to the nearest stop to classify deserts / forests / ranges.
export const LAND_FAMILY_STOPS: { family: ElevationFamily; center: number }[] = [
  { family: "LOW", center: 0.11 },
  { family: "MEDIUM", center: 0.37 },
  { family: "HIGH", center: 0.72 }, // brown rock dominates the high ground (pushed up from 0.635)
  { family: "VERY_HIGH", center: 0.95 }, // gray→white snow compressed to the very crests (was 0.875)
];
export const MOISTURE_STOPS: { band: MoistureBand; center: number }[] = [
  { band: "DRY", center: 0.1 },
  { band: "MID", center: 0.4 },
  { band: "WET", center: 0.8 },
];

