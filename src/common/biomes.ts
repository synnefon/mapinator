import { clamp } from "./util";

// ===================== Public Types =====================
export type Theme =
  | "default"
  | "sage"
  | "verdant"
  | "rainbow"
  | "oasis"
  | "grayscale"
  | "winter"
  | "autumn"
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
  sage: {
    // ocean
    OCEAN: "#5C7285",
    // very high
    DRY_VERY_HIGH: "#888888",
    MID_VERY_HIGH: "#bbbbbb",
    WET_VERY_HIGH: "#E7E8E9",
    // high
    DRY_HIGH: "#babc8a",
    MID_HIGH: "#a8bc8a",
    WET_HIGH: "#9EBC8A",
    // medium
    DRY_MEDIUM: "#92946b",
    MID_MEDIUM: "#85946b",
    WET_MEDIUM: "#73946B",
    // low
    DRY_LOW: "#D2D0A0",
    MID_LOW: "#587d53",
    WET_LOW: "#537D5D",
  },
  verdant: {
    // OCEAN: "#44447a",
    OCEAN: "#22577a",

    DRY_VERY_HIGH: "#a7d9a0",
    MID_VERY_HIGH: "#a0d9a9",
    WET_VERY_HIGH: "#a0d9c0",

    DRY_HIGH: "#29ab01",
    MID_HIGH: "#01ab0f",
    WET_HIGH: "#01ab4b", // 1, 171, 75

    DRY_MEDIUM: "#297f01", // 40, 127, 1
    MID_MEDIUM: "#017f10", // 1, 127, 16
    WET_MEDIUM: "#007f5f", // 1, 127, 75

    DRY_LOW: "#1e6301", // 40, 99, 1
    MID_LOW: "#016310", // 1, 99, 16
    WET_LOW: "#01634b", // 1, 99, 75
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
    DRY_VERY_HIGH: "#E3D2A6", // sage green (dry greenery)
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
  winter: {
    OCEAN: "#5b6f87",
    DRY_VERY_HIGH: "#b0b7bf",
    MID_VERY_HIGH: "#d8dee5",
    WET_VERY_HIGH: "#f4f6f8",
    DRY_HIGH: "#9da7ad",
    MID_HIGH: "#bcc7d0",
    WET_HIGH: "#dce4eb",
    DRY_MEDIUM: "#7f8c91",
    MID_MEDIUM: "#a4b5bd",
    WET_MEDIUM: "#cad5dd",
    DRY_LOW: "#6d7a7f",
    MID_LOW: "#8fa0a8",
    WET_LOW: "#a7bcc4",
  },
  autumn: {
    // Ocean — cool desaturated blue to contrast the warm land
    OCEAN: "#3f5566",

    // Very high — pale golds to off-white (frost-kissed peaks)
    DRY_VERY_HIGH: "#bda77e", // faded tan
    MID_VERY_HIGH: "#d8c9a7", // pale gold
    WET_VERY_HIGH: "#f1e9d5", // soft cream

    // High — burnt ochre, amber, fading green
    DRY_HIGH: "#9a8f57", // warm ochre
    MID_HIGH: "#c48a4d", // amber brown
    WET_HIGH: "#b37b40", // muted olive green (touch of late summer)

    // Medium — peak fall colors
    DRY_MEDIUM: "#7d864e", // pumpkin orange
    MID_MEDIUM: "#e49a3a", // rusty red-orange
    WET_MEDIUM: "#d86b38", // faded green moss

    // Low — ground foliage, leaf litter, and damp soil
    DRY_LOW: "#f2c472", // golden leaves
    MID_LOW: "#b05a2a", // deep rust
    WET_LOW: "#961D00", // earthy green-brown
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
  sage: { saturationScale: 0.95 },
  verdant: { saturationScale: 1.07 },
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
  winter: { saturationScale: 0.95 },
  autumn: { saturationScale: 1.12 },
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
