import { clamp } from "./util";

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

type ElevationFamily = "OCEAN" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
type MoistureBand = "DRY" | "MID" | "WET";

// ===================== Elevation Discretization =====================
// Raw elevation domain is [-1..1], ocean is [-1..0], land is [0..1].
// Breaks are inclusive upper-bounds for each band.
export type ElevationBand =
  | "OCEAN_1"
  | "OCEAN_2"
  | "OCEAN_3"
  | "LOW_1"
  | "LOW_2"
  | "MEDIUM_1"
  | "MEDIUM_2"
  | "HIGH_1"
  | "HIGH_2"
  | "VERY_HIGH_1"
  | "VERY_HIGH_2";

// Continuous elevation -> unified band (or null for ocean)
export function getElevationBandNameRaw(elevation: number): {
  breakPoint: number;
  colorFamily: ElevationFamily;
  band: ElevationBand;
} {
  const firstBreak = ELEVATION_BAND_BREAKS.find(
    ({ breakPoint }) => elevation < breakPoint
  );
  return firstBreak!;
}

const elevationBand = (e: number): ElevationFamily => {
  if (e < 0) return "OCEAN";
  const band = getElevationBandNameRaw(e)!;
  return band.colorFamily;
};

// ===================== Moisture Discretization =====================
const MOISTURE_BAND_BREAKS: readonly {
  band: MoistureBand;
  breakPoint: number;
}[] = [
  { band: "DRY", breakPoint: 0.2 },
  { band: "MID", breakPoint: 0.6 },
  { band: "WET", breakPoint: 1 },
] as const;

const moistureBand = (m: number): MoistureBand => {
  m = clamp(m);
  const ret = MOISTURE_BAND_BREAKS.find(
    ({ breakPoint }) => m <= breakPoint
  )?.band;
  return ret!;
};

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

    // very high — misty rock faces and mossy peaks
    DRY_VERY_HIGH: "#bfb9a4",
    MID_VERY_HIGH: "#c4c2bc",
    WET_VERY_HIGH: "#E7E8E9",

    // high — elevated forest canopy, cooler and lighter greens
    DRY_HIGH: "#7eaa5b", // bright olive canopy, sun-bleached tops
    MID_HIGH: "#649a4b", // balanced mid-green ridge forests
    WET_HIGH: "#4d8f45", // humid alpine growth, moderate depth

    // medium — lowland jungle and wetlands, denser and darker
    DRY_MEDIUM: "#557d3f", // drier forest interior, rich shadows
    MID_MEDIUM: "#457339", // deeper tone, mossy undercanopy
    WET_MEDIUM: "#356a33", // saturated jungle floor / wet fern green

    // low — tropical basins, rich soil, river systems
    DRY_LOW: "#9e8e61", // earthy, sun-touched loam
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

const ELEVATION_BAND_BREAKS: readonly {
  breakPoint: number;
  band: ElevationBand;
  colorFamily: ElevationFamily;
}[] = [
  { breakPoint: -0.7, colorFamily: "OCEAN", band: "OCEAN_3" }, // deep
  { breakPoint: -0.35, colorFamily: "OCEAN", band: "OCEAN_2" }, // medium
  { breakPoint: 0, colorFamily: "OCEAN", band: "OCEAN_1" }, // shallow
  { breakPoint: 0.2, colorFamily: "LOW", band: "LOW_1" },
  { breakPoint: 0.22, colorFamily: "LOW", band: "LOW_2" },
  { breakPoint: 0.35, colorFamily: "MEDIUM", band: "MEDIUM_1" },
  { breakPoint: 0.52, colorFamily: "MEDIUM", band: "MEDIUM_2" },
  { breakPoint: 0.62, colorFamily: "HIGH", band: "HIGH_1" },
  { breakPoint: 0.75, colorFamily: "HIGH", band: "HIGH_2" },
  { breakPoint: 0.87, colorFamily: "VERY_HIGH", band: "VERY_HIGH_1" },
  { breakPoint: 1.0, colorFamily: "VERY_HIGH", band: "VERY_HIGH_2" },
] as const;

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

// ===================== Color lookup =====================

export function colorFor(
  theme: Theme,
  elevation: number,
  moisture: number
): string {
  const eBand = elevationBand(elevation);
  if (eBand === "OCEAN") return BiomeColors[theme].OCEAN;

  const mBand = moistureBand(moisture);

  const key = `${mBand}_${eBand}` as BiomeKey;
  return (BiomeColors[theme][key] ?? BiomeColors.default[key])!;
}
