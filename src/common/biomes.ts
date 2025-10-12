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
  0.3, // MEDIUM_1
  0.5, // MEDIUM_2
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
    // very high
    DRY_VERY_HIGH: "#888888",
    TEMPERATE_VERY_HIGH: "#bbbbbb",
    WET_VERY_HIGH: "#E7E8E9",
    // high
    DRY_HIGH: "#b7a57a",
    TEMPERATE_HIGH: "#a38b67",
    WET_HIGH: "#898C58",
    // medium
    DRY_MEDIUM: "#9F9865",
    TEMPERATE_MEDIUM: "#88aa55",
    WET_MEDIUM: "#679459",
    // low
    DRY_LOW: "#d2b98b",
    TEMPERATE_LOW: "#3f7b44",
    WET_LOW: "#224422",
  },
  oldAtlas: {
    OCEAN: "#6b7c8c",
    DRY_VERY_HIGH: "#8b7f6d",
    TEMPERATE_VERY_HIGH: "#b2a48a",
    WET_VERY_HIGH: "#e8e1d1",
    DRY_HIGH: "#a79372",
    TEMPERATE_HIGH: "#98855e",
    WET_HIGH: "#7d6b4f",
    DRY_MEDIUM: "#c1a777",
    TEMPERATE_MEDIUM: "#b48b5c",
    WET_MEDIUM: "#7c5d3b",
    DRY_LOW: "#d5c29a",
    TEMPERATE_LOW: "#b98c62",
    WET_LOW: "#5e4028",
  },
  verdant: {
    OCEAN: "#3a5a6b",
    DRY_VERY_HIGH: "#6b705c",
    TEMPERATE_VERY_HIGH: "#a5a58d",
    WET_VERY_HIGH: "#d8f3dc",
    DRY_HIGH: "#8f9779",
    TEMPERATE_HIGH: "#70a37f",
    WET_HIGH: "#52b788",
    DRY_MEDIUM: "#9ab97e",
    TEMPERATE_MEDIUM: "#40916c",
    WET_MEDIUM: "#2d6a4f",
    DRY_LOW: "#b5c99a",
    TEMPERATE_LOW: "#1b4332",
    WET_LOW: "#081c15",
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
    OCEAN: "#303843",
    DRY_VERY_HIGH: "#4a4a4a",
    TEMPERATE_VERY_HIGH: "#7a7a7a",
    WET_VERY_HIGH: "#a5a5a5",
    DRY_HIGH: "#5c4a3f",
    TEMPERATE_HIGH: "#704d3d",
    WET_HIGH: "#8b3f2f",
    DRY_MEDIUM: "#6b4e43",
    TEMPERATE_MEDIUM: "#8c3e2e",
    WET_MEDIUM: "#a8322a",
    DRY_LOW: "#7a5c51",
    TEMPERATE_LOW: "#662c20",
    WET_LOW: "#3b1810",
  },
  greyscale: {
    OCEAN: "#444444",
    DRY_VERY_HIGH: "#888888",
    TEMPERATE_VERY_HIGH: "#aaaaaa",
    WET_VERY_HIGH: "#dddddd",
    DRY_HIGH: "#777777",
    TEMPERATE_HIGH: "#999999",
    WET_HIGH: "#bbbbbb",
    DRY_MEDIUM: "#666666",
    TEMPERATE_MEDIUM: "#888888",
    WET_MEDIUM: "#aaaaaa",
    DRY_LOW: "#555555",
    TEMPERATE_LOW: "#777777",
    WET_LOW: "#999999",
  },
  winter: {
    OCEAN: "#5b6f87",
    DRY_VERY_HIGH: "#b0b7bf",
    TEMPERATE_VERY_HIGH: "#d8dee5",
    WET_VERY_HIGH: "#f4f6f8",
    DRY_HIGH: "#9da7ad",
    TEMPERATE_HIGH: "#bcc7d0",
    WET_HIGH: "#dce4eb",
    DRY_MEDIUM: "#7f8c91",
    TEMPERATE_MEDIUM: "#a4b5bd",
    WET_MEDIUM: "#cad5dd",
    DRY_LOW: "#6d7a7f",
    TEMPERATE_LOW: "#8fa0a8",
    WET_LOW: "#a7bcc4",
  },
  autumn: {
    OCEAN: "#3a4a5a",
    DRY_VERY_HIGH: "#8c6e53",
    TEMPERATE_VERY_HIGH: "#b89b7e",
    WET_VERY_HIGH: "#e4d4b7",
    DRY_HIGH: "#b57f3d",
    TEMPERATE_HIGH: "#a0622a",
    WET_HIGH: "#7c4724",
    DRY_MEDIUM: "#d49e4e",
    TEMPERATE_MEDIUM: "#c07a2b",
    WET_MEDIUM: "#8a4c20",
    DRY_LOW: "#e8c278",
    TEMPERATE_LOW: "#b86027",
    WET_LOW: "#5a2f1b",
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
