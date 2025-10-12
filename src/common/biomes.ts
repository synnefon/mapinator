import { clamp } from "./util";

// ===================== Public Types =====================
export type Theme =
  | "default"
  | "sage"
  | "verdant"
  | "rainbow"
  | "oasis"
  | "stone"
  | "winter"
  | "autumn";

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

// ===================== Fast Helpers =====================

// Upper-bound binary search: first index i where x <= arr[i].
const ub = (x: number, arr: readonly number[]) => {
  let lo = 0,
    hi = arr.length - 1,
    mid = 0;
  while (lo < hi) {
    mid = (lo + hi) >>> 1;
    if (x <= arr[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
};

// ===================== Elevation Thresholds =====================
// Raw elevation domain is [-1..1], land is [0..1]. We classify only land.
// Breaks are inclusive upper-bounds for each band.
export type ElevationBand =
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

// Continuous elevation -> family
const familyOfElevation = (e: number): ElevationFamily => {
  if (e < 0) return "OCEAN";
  const band = getElevationBandNameRaw(e)!;
  return band.colorFamily;
};

// ===================== Moisture Discretization (Scalar → 3 bands) =====================
const MOISTURE_BREAKS_3: readonly number[] = [0.2, 0.5, 0.8] as const; // DRY | MID | WET

const MOISTURE_BAND_ORDER: readonly MoistureBand[] = [
  "DRY",
  "MID",
  "WET",
] as const;

const moistureBandOf = (m: number): MoistureBand => {
  const idx = ub(clamp(m), MOISTURE_BREAKS_3);
  return MOISTURE_BAND_ORDER[idx];
};

// ===================== Grid Mapping (ElevationFamily × MoistureBand → BiomeKey) =====================
type BiomeGrid = Record<
  Exclude<ElevationFamily, "OCEAN">,
  Record<MoistureBand, BiomeKey>
>;

const BIOME_GRID: BiomeGrid = {
  LOW: {
    DRY: "DRY_LOW",
    MID: "MID_LOW",
    WET: "WET_LOW",
  },
  MEDIUM: {
    DRY: "DRY_MEDIUM",
    MID: "MID_MEDIUM",
    WET: "WET_MEDIUM",
  },
  HIGH: {
    DRY: "DRY_HIGH",
    MID: "MID_HIGH",
    WET: "WET_HIGH",
  },
  VERY_HIGH: {
    DRY: "DRY_VERY_HIGH",
    MID: "MID_VERY_HIGH",
    WET: "WET_VERY_HIGH",
  },
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
    DRY_MEDIUM: "#8A784E",
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
  stone: {
    OCEAN: "#6b7e84",

    DRY_VERY_HIGH: "#b2b2b2",
    MID_VERY_HIGH: "#d3d1cc",
    WET_VERY_HIGH: "#e8e7e4",

    DRY_HIGH: "#9b8f83",
    MID_HIGH: "#b1a496",
    WET_HIGH: "#c6b9ac",

    DRY_MEDIUM: "#85796e",
    MID_MEDIUM: "#9d9287",
    WET_MEDIUM: "#b6aca2",

    DRY_LOW: "#6d6259",
    MID_LOW: "#8a7f76",
    WET_LOW: "#a79e96",
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
} as const;

const ELEVATION_BAND_BREAKS: readonly {
  breakPoint: number;
  band: ElevationBand;
  colorFamily: ElevationFamily;
}[] = [
  { breakPoint: 0.2, colorFamily: "LOW", band: "LOW_1" },
  { breakPoint: 0.22, colorFamily: "LOW", band: "LOW_2" },
  { breakPoint: 0.35, colorFamily: "MEDIUM", band: "MEDIUM_1" },
  { breakPoint: 0.52, colorFamily: "MEDIUM", band: "MEDIUM_2" },
  { breakPoint: 0.62, colorFamily: "HIGH", band: "HIGH_1" },
  { breakPoint: 0.75, colorFamily: "HIGH", band: "HIGH_2" },
  { breakPoint: 0.87, colorFamily: "VERY_HIGH", band: "VERY_HIGH_1" },
  { breakPoint: 1.0, colorFamily: "VERY_HIGH", band: "VERY_HIGH_2" },
] as const;

// ===================== Optional: Lightness & Theme overrides =====================
export const BASE_LIGHTNESS: Record<ElevationBand, number> = {
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
  forcestone?: boolean;
};

export const THEME_OVERRIDES: Record<Theme, ThemeAdjust> = {
  default: {
    saturationScale: 1.0,
    // lightness: {
    //   LOW_1: 0,
    //   LOW_2: 0,
    //   MEDIUM_1: -0.05,
    //   MEDIUM_2: 0,
    //   HIGH_1: -0.05,
    //   HIGH_2: 0,
    //   VERY_HIGH_1: -0.05,
    //   VERY_HIGH_2: 0,
    // },
  },
  sage: {
    // lightness: {
    //   LOW_1: +0.1,
    //   LOW_2: +0.05,
    //   MEDIUM_2: -0.02,
    //   HIGH_1: -0.05,
    //   HIGH_2: -0.08,
    //   VERY_HIGH: -0.12,
    // },
    saturationScale: 0.92,
  },
  verdant: {
    // lightness: {
    //   LOW_1: +0.1,
    //   LOW_2: +0.06,
    //   MEDIUM_1: +0.01,
    //   MEDIUM_2: -0.02,
    //   HIGH_1: -0.06,
    //   HIGH_2: -0.11,
    //   VERY_HIGH: -0.15,
    // },
    saturationScale: 1.07,
  },
  rainbow: {
    saturationScale: 1.12,
    // lightness: {
    //   LOW_1: +0.03,
    //   LOW_2: +0.02,
    //   MEDIUM_1: +0.01,
    //   MEDIUM_2: +0.01,
    //   HIGH_1: -0.02,
    //   HIGH_2: -0.04,
    //   VERY_HIGH: -0.05,
    // },
  },
  oasis: {
    lightness: {
      LOW_1: 0.005,
      LOW_2: 0.01,
      MEDIUM_1: 0.02,
      MEDIUM_2: 0.01,
      HIGH_1: 0.005,
      HIGH_2: 0.01,
      VERY_HIGH_1: 0.3,
      VERY_HIGH_2: 0.05,
    },
    saturationScale: 0.85,
  },
  winter: {
    saturationScale: 0.95,
    // lightness: { HIGH_1: -0.02, HIGH_2: -0.03, VERY_HIGH: -0.03 },
  },
  autumn: {
    saturationScale: 1.12,
    // lightness: {
    //   LOW_1: +0.05,
    //   LOW_2: +0.03,
    //   MEDIUM_1: +0.02,
    //   MEDIUM_2: +0.0,
    //   HIGH_1: -0.02,
    //   HIGH_2: -0.05,
    //   VERY_HIGH: -0.06,
    // },
  },
  stone: { saturationScale: 0.0, forcestone: true },
};

/**
 * Scalar → Biome color lookup using discretized elevation & moisture.
 * @param theme Theme palette to use
 * @param elevation Continuous elevation (≈[-1,1]); <0 means ocean
 * @param moisture Continuous moisture [0,1]
 */
export function colorFor(
  theme: Theme,
  elevation: number,
  moisture: number
): string {
  const fam = familyOfElevation(elevation);
  if (fam === "OCEAN") return BiomeColors[theme].OCEAN;

  const band = moistureBandOf(moisture); // DRY | MID | WET
  const key = BIOME_GRID[fam][band];
  return (BiomeColors[theme][key] ?? BiomeColors.default[key])!;
}
