// ===================== Public Types =====================
export type Theme =
  | "default"
  | "oldAtlas"
  | "verdant"
  | "rainbow"
  | "ashfall"
  | "greyscale"
  | "winter"
  | "autumn";

export type BiomeKey =
  // water
  | "OCEAN"
  // very high elevation
  | "DRY_VERY_HIGH"
  | "TEMPERATE_VERY_HIGH"
  | "WET_VERY_HIGH"
  // high elevation
  | "DRY_HIGH"
  | "TEMPERATE_HIGH"
  | "WET_HIGH"
  // medium elevation
  | "DRY_MEDIUM"
  | "TEMPERATE_MEDIUM"
  | "WET_MEDIUM"
  // low elevation
  | "DRY_LOW"
  | "TEMPERATE_LOW"
  | "WET_LOW";

type ElevationFamily = "OCEAN" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
type MoistureBand = "DRY" | "MID" | "WET";

// ===================== Fast Helpers =====================
// local clamp to avoid imports in hot path
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
  | "VERY_HIGH";

const ELEVATION_BANDS_ORDER: readonly ElevationBand[] = [
  "LOW_1",
  "LOW_2",
  "MEDIUM_1",
  "MEDIUM_2",
  "HIGH_1",
  "HIGH_2",
  "VERY_HIGH",
] as const;

export const ELEVATION_BAND_BREAKS: readonly number[] = [
  0.125, // LOW_1
  0.25, // LOW_2
  0.4, // MEDIUM_1
  0.55, // MEDIUM_2
  0.6, // HIGH_1
  0.75, // HIGH_2
  1.0, // VERY_HIGH
] as const;

const FAMILY_OF_BAND: Record<
  ElevationBand,
  Exclude<ElevationFamily, "OCEAN">
> = {
  LOW_1: "LOW",
  LOW_2: "LOW",
  MEDIUM_1: "MEDIUM",
  MEDIUM_2: "MEDIUM",
  HIGH_1: "HIGH",
  HIGH_2: "HIGH",
  VERY_HIGH: "VERY_HIGH",
} as const;

// Continuous elevation -> unified band (or null for ocean)
export function getElevationBandNameRaw(e: number): ElevationBand | null {
  if (e < 0) return null;
  const idx = ub(e, ELEVATION_BAND_BREAKS);
  return ELEVATION_BANDS_ORDER[idx];
}

// Continuous elevation -> family
const familyOfElevation = (e: number): ElevationFamily => {
  if (e < 0) return "OCEAN";
  const band = getElevationBandNameRaw(e)!;
  return FAMILY_OF_BAND[band];
};

// ===================== Moisture Discretization (Scalar → 3 bands) =====================
const MOISTURE_BREAKS_3: readonly number[] = [1 / 3, 2 / 3, 1.0] as const; // DRY | MID | WET

const MOISTURE_BAND_ORDER: readonly MoistureBand[] = [
  "DRY",
  "MID",
  "WET",
] as const;

const moistureBandOf = (m: number): MoistureBand => {
  const idx = ub(clamp01(m), MOISTURE_BREAKS_3);
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
    MID: "TEMPERATE_LOW",
    WET: "WET_LOW",
  },
  MEDIUM: {
    DRY: "DRY_MEDIUM",
    MID: "TEMPERATE_MEDIUM",
    WET: "WET_MEDIUM",
  },
  HIGH: {
    DRY: "DRY_HIGH",
    MID: "TEMPERATE_HIGH",
    WET: "WET_HIGH",
  },
  VERY_HIGH: {
    DRY: "DRY_VERY_HIGH",
    MID: "TEMPERATE_VERY_HIGH",
    WET: "WET_VERY_HIGH",
  },
};

// ===================== Theme → BiomeKey → Hex =====================
export const BiomeColors: Record<Theme, Record<BiomeKey, string>> = {
  default: {
    // ocean
    OCEAN: "#44447a",

    // very high (stone → glacier)
    DRY_VERY_HIGH: "#888888",
    TEMPERATE_VERY_HIGH: "#bbbbbb",
    WET_VERY_HIGH: "#E7E8E9",

    // high (dry rock → lush alpine)
    DRY_HIGH: "#b9b39a",
    TEMPERATE_HIGH: "#9db785",
    WET_HIGH: "#b6d6a2",

    // medium (grass → forest)
    DRY_MEDIUM: "#c3b86b",
    TEMPERATE_MEDIUM: "#88aa55",
    WET_MEDIUM: "#679459",

    // low (sand → swampy)
    DRY_LOW: "#d2b98b",
    TEMPERATE_LOW: "#3f7b44",
    WET_LOW: "#224422",
  },
  oldAtlas: {
    OCEAN: "#44447a",
    DRY_VERY_HIGH: "#A59C8E",
    TEMPERATE_VERY_HIGH: "#CEC7B4",
    WET_VERY_HIGH: "#E7E8E9",
    DRY_HIGH: "#D8C9A9",
    TEMPERATE_HIGH: "#97A792",
    WET_HIGH: "#6C887E",
    DRY_MEDIUM: "#B9B080",
    TEMPERATE_MEDIUM: "#6E8B6C",
    WET_MEDIUM: "#486F69",
    DRY_LOW: "#D9B67E",
    TEMPERATE_LOW: "#A2B079",
    WET_LOW: "#3E5F54",
  },
  verdant: {
    OCEAN: "#174C48",
    DRY_VERY_HIGH: "#8AA39E",
    TEMPERATE_VERY_HIGH: "#B3CBB9",
    WET_VERY_HIGH: "#E7EFEA",
    DRY_HIGH: "#D4CF89",
    TEMPERATE_HIGH: "#A5C4B7",
    WET_HIGH: "#3F7F6E",
    DRY_MEDIUM: "#A1D082",
    TEMPERATE_MEDIUM: "#6FAF6F",
    WET_MEDIUM: "#3C7E69",
    DRY_LOW: "#C4BF4F",
    TEMPERATE_LOW: "#8BCF75",
    WET_LOW: "#24614B",
  },
  rainbow: {
    // ocean
    OCEAN: "#000000",
    // very high
    DRY_VERY_HIGH: "#333399",
    TEMPERATE_VERY_HIGH: "#663399",
    WET_VERY_HIGH: "#AA66CC",
    // high
    DRY_HIGH: "#55BB88",
    TEMPERATE_HIGH: "#3388CC",
    WET_HIGH: "#2244AA",
    // medium
    DRY_MEDIUM: "#E8E600",
    TEMPERATE_MEDIUM: "#88CC44",
    WET_MEDIUM: "#33AA66",
    // low
    DRY_LOW: "#C93C00",
    TEMPERATE_LOW: "#FF7F00",
    WET_LOW: "#FFB733",
  },
  ashfall: {
    OCEAN: "#2A2A2C",
    DRY_VERY_HIGH: "#8E8983",
    TEMPERATE_VERY_HIGH: "#C2BEB8",
    WET_VERY_HIGH: "#E5E3E0",
    DRY_HIGH: "#7F746A",
    TEMPERATE_HIGH: "#AAA398",
    WET_HIGH: "#8B857F",
    DRY_MEDIUM: "#6F6862",
    TEMPERATE_MEDIUM: "#7A736E",
    WET_MEDIUM: "#86796E",
    DRY_LOW: "#7A5E4D",
    TEMPERATE_LOW: "#726C65",
    WET_LOW: "#494644",
  },
  greyscale: {
    OCEAN: "#111111",
    DRY_VERY_HIGH: "#DADADA",
    TEMPERATE_VERY_HIGH: "#EAEAEA",
    WET_VERY_HIGH: "#FFFFFF",
    DRY_HIGH: "#6A6A6A",
    TEMPERATE_HIGH: "#9E9E9E",
    WET_HIGH: "#B7B7B7",
    DRY_MEDIUM: "#717171",
    TEMPERATE_MEDIUM: "#7A7A7A",
    WET_MEDIUM: "#8A8A8A",
    DRY_LOW: "#2B2B2B",
    TEMPERATE_LOW: "#3F3F3F",
    WET_LOW: "#585858",
  },
  winter: {
    OCEAN: "#0F3A5E",
    DRY_VERY_HIGH: "#59626B",
    TEMPERATE_VERY_HIGH: "#A7B7C1",
    WET_VERY_HIGH: "#EAF3F9",
    DRY_HIGH: "#4E5456",
    TEMPERATE_HIGH: "#8DA8B0",
    WET_HIGH: "#DFF1F6",
    DRY_MEDIUM: "#64717A",
    TEMPERATE_MEDIUM: "#98B1BA",
    WET_MEDIUM: "#D8EDF5",
    DRY_LOW: "#58626A",
    TEMPERATE_LOW: "#7D9096",
    WET_LOW: "#E8F3F7",
  },
  autumn: {
    OCEAN: "#1F3A5F",
    DRY_VERY_HIGH: "#8F8A84",
    TEMPERATE_VERY_HIGH: "#B79E7F",
    WET_VERY_HIGH: "#F6F2E9",
    DRY_HIGH: "#CFAF7A",
    TEMPERATE_HIGH: "#9CAF7A",
    WET_HIGH: "#244238",
    DRY_MEDIUM: "#C5B16A",
    TEMPERATE_MEDIUM: "#B73A2E",
    WET_MEDIUM: "#3E5F47",
    DRY_LOW: "#C96A2B",
    TEMPERATE_LOW: "#C3B04D",
    WET_LOW: "#2F5C4C",
  },
} as const;

// ===================== Hot-path API =====================
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

/** Also expose the biome key if needed elsewhere. */
export function biomeKeyFor(elevation: number, moisture: number): BiomeKey {
  const fam = familyOfElevation(elevation);
  if (fam === "OCEAN") return "OCEAN";
  const band = moistureBandOf(moisture);
  return BIOME_GRID[fam][band];
}

// ===================== Optional: Lightness & Theme overrides =====================
export const BASE_LIGHTNESS: Record<ElevationBand, number> = {
  LOW_1: +0.08,
  LOW_2: +0.04,
  MEDIUM_1: 0.0,
  MEDIUM_2: -0.03,
  HIGH_1: -0.06,
  HIGH_2: -0.1,
  VERY_HIGH: -0.14,
};

export type ThemeAdjust = {
  lightness?: Partial<Record<ElevationBand, number>>;
  saturationScale?: number;
  forceGreyscale?: boolean;
};

export const THEME_OVERRIDES: Record<Theme, ThemeAdjust> = {
  default: { saturationScale: 1.0 },
  oldAtlas: {
    lightness: {
      LOW_1: +0.1,
      LOW_2: +0.05,
      MEDIUM_2: -0.02,
      HIGH_1: -0.05,
      HIGH_2: -0.08,
      VERY_HIGH: -0.12,
    },
    saturationScale: 0.92,
  },
  verdant: {
    lightness: {
      LOW_1: +0.1,
      LOW_2: +0.06,
      MEDIUM_1: +0.01,
      MEDIUM_2: -0.02,
      HIGH_1: -0.06,
      HIGH_2: -0.11,
      VERY_HIGH: -0.15,
    },
    saturationScale: 1.07,
  },
  rainbow: {
    saturationScale: 1.12,
    lightness: {
      LOW_1: +0.03,
      LOW_2: +0.02,
      MEDIUM_1: +0.01,
      MEDIUM_2: +0.01,
      HIGH_1: -0.02,
      HIGH_2: -0.04,
      VERY_HIGH: -0.05,
    },
  },
  ashfall: {
    lightness: {
      LOW_1: +0.04,
      LOW_2: +0.02,
      MEDIUM_1: -0.02,
      MEDIUM_2: -0.05,
      HIGH_1: -0.1,
      HIGH_2: -0.14,
      VERY_HIGH: -0.18,
    },
    saturationScale: 0.85,
  },
  winter: {
    saturationScale: 0.95,
    lightness: { HIGH_1: -0.02, HIGH_2: -0.03, VERY_HIGH: -0.03 },
  },
  autumn: {
    saturationScale: 1.12,
    lightness: {
      LOW_1: +0.05,
      LOW_2: +0.03,
      MEDIUM_1: +0.02,
      MEDIUM_2: +0.0,
      HIGH_1: -0.02,
      HIGH_2: -0.05,
      VERY_HIGH: -0.06,
    },
  },
  greyscale: { saturationScale: 0.0, forceGreyscale: true },
};
