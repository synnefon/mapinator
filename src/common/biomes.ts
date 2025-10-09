// ===================== Biome + Schemes =====================
export interface Biome {
  name: string;
  color: string;
}

export type theme =
  | "default"
  | "oldAtlas"
  | "verdant"
  | "rainbow"
  | "ashfall"
  | "greyscale"
  | "winter"
  | "autumn"
  ;

// ===================== Palettes =====================
export const Biomes = {
  default: {
    OCEAN: { color: "#44447a", name: "ocean" }, SALT_FLATS: { color: "#e6d7b3", name: "salt flats" },
    SUBTROPICAL_DESERT: { color: "#d2b98b", name: "subtropical desert" }, SAVANNA: { color: "#a2b34c", name: "savanna" },
    GRASSLAND: { color: "#88aa55", name: "grassland" }, TROPICAL_DRY_FOREST: { color: "#669944", name: "tropical dry forest" },
    TROPICAL_SEASONAL_FOREST: { color: "#559944", name: "tropical seasonal forest" }, TROPICAL_RAIN_FOREST: { color: "#337755", name: "tropical rain forest" },
    SWAMP: { color: "#225533", name: "swamp" }, SEMI_ARID_PLAINS: { color: "#c9d29b", name: "semi-arid plains" },
    TEMPERATE_DESERT: { color: "#d8cfa3", name: "temperate desert" }, STEPPE: { color: "#aab36b", name: "steppe" },
    PRAIRIE: { color: "#89a55b", name: "prairie" }, DECIDUOUS_FOREST: { color: "#679459", name: "deciduous forest" },
    MIXED_FOREST: { color: "#557a50", name: "mixed forest" }, TEMPERATE_RAIN_FOREST: { color: "#448855", name: "temperate rain forest" },
    ALPINE_MEADOW: { color: "#88aa77", name: "alpine meadow" }, SHRUBLAND: { color: "#889977", name: "shrubland" },
    TAIGA: { color: "#99aa77", name: "taiga" }, BOREAL_FOREST: { color: "#779966", name: "boreal forest" },
    BARREN_ROCK: { color: "#888888", name: "barren rock" }, TALUS_SLOPE: { color: "#999999", name: "talus slope" },
    TUNDRA: { color: "#bbbbaa", name: "tundra" }, PERMAFROST: { color: "#cccccc", name: "permafrost" },
    GLACIER: { color: "#dddde4", name: "glacier" }
  },
  oldAtlas: {
    OCEAN: { name: "ocean", color: "#44447a" }, SALT_FLATS: { name: "salt flats", color: "#F5E6C5" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#D9B67E" }, SAVANNA: { name: "savanna", color: "#C1B36C" },
    GRASSLAND: { name: "grassland", color: "#A2B079" }, TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#7E9A67" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#668A62" }, TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#4C7A67" },
    SWAMP: { name: "swamp", color: "#3E5F54" }, SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#CFC29A" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#D8C9A9" }, STEPPE: { name: "steppe", color: "#B9B080" },
    PRAIRIE: { name: "prairie", color: "#9AA87D" }, DECIDUOUS_FOREST: { name: "deciduous forest", color: "#6E8B6C" },
    MIXED_FOREST: { name: "mixed forest", color: "#5B7E6B" }, TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#486F69" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#97A792" }, SHRUBLAND: { name: "shrubland", color: "#A8AA95" },
    TAIGA: { name: "taiga", color: "#889A8C" }, BOREAL_FOREST: { name: "boreal forest", color: "#6C887E" },
    BARREN_ROCK: { name: "barren rock", color: "#A59C8E" }, TALUS_SLOPE: { name: "talus slope", color: "#B8B0A3" },
    TUNDRA: { name: "tundra", color: "#CEC7B4" }, PERMAFROST: { name: "permafrost", color: "#E1DDD1" },
    GLACIER: { name: "glacier", color: "#E7E8E9" }
  },
  verdant: {
    OCEAN: { name: "ocean", color: "#174C48" }, SALT_FLATS: { name: "salt flats", color: "#E6E0C8" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#C4BF4F" }, SAVANNA: { name: "savanna", color: "#B6D352" },
    GRASSLAND: { name: "grassland", color: "#8BCF75" }, TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#6AA36A" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#4E955F" }, TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#3C8C61" },
    SWAMP: { name: "swamp", color: "#24614B" }, SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#CFCB7A" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#D4CF89" }, STEPPE: { name: "steppe", color: "#A1D082" },
    PRAIRIE: { name: "prairie", color: "#82C97B" }, DECIDUOUS_FOREST: { name: "deciduous forest", color: "#6FAF6F" },
    MIXED_FOREST: { name: "mixed forest", color: "#579B6F" }, TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#3C7E69" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#A5C4B7" }, SHRUBLAND: { name: "shrubland", color: "#7FA585" },
    TAIGA: { name: "taiga", color: "#2F776C" }, BOREAL_FOREST: { name: "boreal forest", color: "#3F7F6E" },
    BARREN_ROCK: { name: "barren rock", color: "#8AA39E" }, TALUS_SLOPE: { name: "talus slope", color: "#9EB6A9" },
    TUNDRA: { name: "tundra", color: "#B3CBB9" }, PERMAFROST: { name: "permafrost", color: "#DDE7E2" },
    GLACIER: { name: "glacier", color: "#E7EFEA" }
  },
  rainbow: {
    OCEAN: { name: "ocean", color: "#1E63EE" },                  // deep blue
    SALT_FLATS: { name: "salt flats", color: "#FFF1C2" },        // pale yellow
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#FF8A33" }, // orange
    SAVANNA: { name: "savanna", color: "#FFB433" },              // amber
    GRASSLAND: { name: "grassland", color: "#B9E64D" },          // yellow-green
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#6EE16A" }, // green
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#2FCC8B" }, // mint/teal
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#00B7D4" }, // cyan
    SWAMP: { name: "swamp", color: "#008C95" },                  // deep teal
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#FFE1C6" }, // light peach (was white)
    TEMPERATE_DESERT: { name: "temperate desert", color: "#FFD6B3" }, // light peach
    STEPPE: { name: "steppe", color: "#EFD24E" },                // gold
    PRAIRIE: { name: "prairie", color: "#A9E658" },              // chartreuse
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#4FD56D" },  // emerald
    MIXED_FOREST: { name: "mixed forest", color: "#2EC49B" },    // aqua-green
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#2CA7F8" }, // sky blue
    ALPINE_MEADOW: { name: "alpine meadow", color: "#6DB5FF" },  // light blue
    SHRUBLAND: { name: "shrubland", color: "#7E8BFF" },          // periwinkle
    TAIGA: { name: "taiga", color: "#6C74FF" },                  // indigo-blue
    BOREAL_FOREST: { name: "boreal forest", color: "#B07BFF" },  // soft violet (was white)
    BARREN_ROCK: { name: "barren rock", color: "#D1B3FF" },      // lavender (was white)
    TALUS_SLOPE: { name: "talus slope", color: "#FF63D2" },      // magenta
    TUNDRA: { name: "tundra", color: "#FF9ACE" },                // pink
    PERMAFROST: { name: "permafrost", color: "#FFD7F0" },        // pale pink
    GLACIER: { name: "glacier", color: "#F0F4FF" },              // very light blue, not pure white
  },
  ashfall: {
    OCEAN: { name: "ocean", color: "#2A2A2C" }, SALT_FLATS: { name: "salt flats", color: "#9A9189" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#7A5E4D" }, SAVANNA: { name: "savanna", color: "#7A6A5C" },
    GRASSLAND: { name: "grassland", color: "#726C65" }, TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#6F665E" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#5F5A54" }, TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#55524E" },
    SWAMP: { name: "swamp", color: "#494644" }, SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#6C635C" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#7F746A" }, STEPPE: { name: "steppe", color: "#6F6862" },
    PRAIRIE: { name: "prairie", color: "#756E67" }, DECIDUOUS_FOREST: { name: "deciduous forest", color: "#7A736E" },
    MIXED_FOREST: { name: "mixed forest", color: "#6D6761" }, TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#86796E" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#AAA398" }, SHRUBLAND: { name: "shrubland", color: "#6E625C" },
    TAIGA: { name: "taiga", color: "#99938C" }, BOREAL_FOREST: { name: "boreal forest", color: "#8B857F" },
    BARREN_ROCK: { name: "barren rock", color: "#8E8983" }, TALUS_SLOPE: { name: "talus slope", color: "#A39E98" },
    TUNDRA: { name: "tundra", color: "#C2BEB8" }, PERMAFROST: { name: "permafrost", color: "#D0CCC7" },
    GLACIER: { name: "glacier", color: "#E5E3E0" }
  },
  greyscale: {
    OCEAN: { name: "ocean", color: "#111111" }, SALT_FLATS: { name: "salt flats", color: "#262626" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#2B2B2B" }, SAVANNA: { name: "savanna", color: "#383838" },
    GRASSLAND: { name: "grassland", color: "#3F3F3F" }, TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#484848" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#4F4F4F" }, TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#5F5F5F" },
    SWAMP: { name: "swamp", color: "#585858" }, SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#616161" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#6A6A6A" }, STEPPE: { name: "steppe", color: "#717171" },
    PRAIRIE: { name: "prairie", color: "#757575" }, DECIDUOUS_FOREST: { name: "deciduous forest", color: "#7A7A7A" },
    MIXED_FOREST: { name: "mixed forest", color: "#838383" }, TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#8A8A8A" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#9E9E9E" }, SHRUBLAND: { name: "shrubland", color: "#AFAFAF" },
    TAIGA: { name: "taiga", color: "#BFBFBF" }, BOREAL_FOREST: { name: "boreal forest", color: "#B7B7B7" },
    BARREN_ROCK: { name: "barren rock", color: "#DADADA" }, TALUS_SLOPE: { name: "talus slope", color: "#D5D5D5" },
    TUNDRA: { name: "tundra", color: "#EAEAEA" }, PERMAFROST: { name: "permafrost", color: "#F5F5F5" },
    GLACIER: { name: "glacier", color: "#FFFFFF" }
  },
  winter: {
    OCEAN: { name: "ocean", color: "#0F3A5E" }, // unchanged sea
    SALT_FLATS: { name: "salt flats", color: "#4A5158" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#58626A" },
    SAVANNA: { name: "savanna", color: "#6A7880" },
    GRASSLAND: { name: "grassland", color: "#7D9096" },
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#9CB2B8" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#B5CDD4" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#D1E6EE" },
    SWAMP: { name: "swamp", color: "#E8F3F7" },
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#515B63" },
    STEPPE: { name: "steppe", color: "#64717A" },
    PRAIRIE: { name: "prairie", color: "#7A8A93" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#98B1BA" },
    MIXED_FOREST: { name: "mixed forest", color: "#B7CFD7" },
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#D8EDF5" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#4E5456" },
    SHRUBLAND: { name: "shrubland", color: "#657074" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#8DA8B0" },
    TAIGA: { name: "taiga", color: "#B8D4DB" },
    BOREAL_FOREST: { name: "boreal forest", color: "#DFF1F6" },
    BARREN_ROCK: { name: "barren rock", color: "#59626B" },
    TALUS_SLOPE: { name: "talus slope", color: "#77838C" },
    TUNDRA: { name: "tundra", color: "#A7B7C1" },
    PERMAFROST: { name: "permafrost", color: "#D0DEE6" },
    GLACIER: { name: "glacier", color: "#EAF3F9" }, // not pure white
  },
  autumn: {
    OCEAN: { name: "ocean", color: "#1F3A5F" },                 // cold lake blue
    SALT_FLATS: { name: "salt flats", color: "#EAD9B0" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#C96A2B" }, // burnt orange
    SAVANNA: { name: "savanna", color: "#D9902B" },             // amber
    GRASSLAND: { name: "grassland", color: "#C3B04D" },         // mustard
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#C86C3B" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#D45A24" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#A8432E" },
    SWAMP: { name: "swamp", color: "#2F5C4C" },                  // cedar/teal
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#D6BF8A" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#CFAF7A" },
    STEPPE: { name: "steppe", color: "#C5B16A" },
    PRAIRIE: { name: "prairie", color: "#B3B55E" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#B73A2E" }, // maple red
    MIXED_FOREST: { name: "mixed forest", color: "#8E4F2F" },         // russet
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#3E5F47" }, // deep evergreen
    ALPINE_MEADOW: { name: "alpine meadow", color: "#9CAF7A" },
    SHRUBLAND: { name: "shrubland", color: "#8C7A4E" },
    TAIGA: { name: "taiga", color: "#2F513D" },
    BOREAL_FOREST: { name: "boreal forest", color: "#244238" },
    BARREN_ROCK: { name: "barren rock", color: "#8F8A84" },
    TALUS_SLOPE: { name: "talus slope", color: "#A8A29A" },
    TUNDRA: { name: "tundra", color: "#B79E7F" },
    PERMAFROST: { name: "permafrost", color: "#E3D8C8" },
    GLACIER: { name: "glacier", color: "#F6F2E9" },             // warm off-white
  },

} as const;


// === Derive keys from palette (no duplicate list to maintain)
export type BiomeKey = keyof typeof Biomes["default"];
export const BiomeKeys = Object.keys(Biomes.default) as BiomeKey[];

// ===================== Bands (single source of truth) =====================
export const BANDS = [
  { name: "OCEAN", family: "OCEAN", range: [-1.0, 0.0] as number[] },
  { name: "LOW_1", family: "LOW", range: [0.0, 0.125] as number[] },
  { name: "LOW_2", family: "LOW", range: [0.125, 0.25] as number[] },
  { name: "MEDIUM_1", family: "MEDIUM", range: [0.25, 0.35] as number[] },
  { name: "MEDIUM_2", family: "MEDIUM", range: [0.35, 0.45] as number[] },
  { name: "HIGH_1", family: "HIGH", range: [0.45, 0.525] as number[] },
  { name: "HIGH_2", family: "HIGH", range: [0.525, 0.6] as number[] },
  { name: "VERY_HIGH", family: "VERY_HIGH", range: [0.6, 1.0] as number[] },
] as const;

export type BandSpec = typeof BANDS[number];
export type BandName = BandSpec["name"];
export type ElevationFamily = BandSpec["family"];

// ===================== Moisture -> Biome per family (DRY) =====================
export type MoistureRule = { m: [number, number]; key: BiomeKey };

export const MOISTURE_BY_FAMILY: Record<ElevationFamily, MoistureRule[]> = {
  OCEAN: [{ m: [0, 1], key: "OCEAN" }],
  VERY_HIGH: [
    { m: [0, 0.15], key: "BARREN_ROCK" },
    { m: [0.15, 0.35], key: "TALUS_SLOPE" },
    { m: [0.35, 0.6], key: "TUNDRA" },
    { m: [0.6, 0.8], key: "PERMAFROST" },
    { m: [0.8, 1], key: "GLACIER" },
  ],
  HIGH: [
    { m: [0, 0.25], key: "TEMPERATE_DESERT" },
    { m: [0.25, 0.45], key: "SHRUBLAND" },
    { m: [0.45, 0.65], key: "ALPINE_MEADOW" },
    { m: [0.65, 0.85], key: "TAIGA" },
    { m: [0.85, 1], key: "BOREAL_FOREST" },
  ],
  MEDIUM: [
    { m: [0, 0.15], key: "SEMI_ARID_PLAINS" },
    { m: [0.15, 0.3], key: "STEPPE" },
    { m: [0.3, 0.45], key: "PRAIRIE" },
    { m: [0.45, 0.65], key: "DECIDUOUS_FOREST" },
    { m: [0.65, 0.85], key: "MIXED_FOREST" },
    { m: [0.85, 1], key: "TEMPERATE_RAIN_FOREST" },
  ],
  LOW: [
    { m: [0, 0.1], key: "SALT_FLATS" },
    { m: [0.1, 0.25], key: "SUBTROPICAL_DESERT" },
    { m: [0.25, 0.45], key: "SAVANNA" },
    { m: [0.45, 0.6], key: "GRASSLAND" },
    { m: [0.6, 0.75], key: "TROPICAL_DRY_FOREST" },
    { m: [0.75, 0.9], key: "TROPICAL_SEASONAL_FOREST" },
    { m: [0.9, 1], key: "SWAMP" },
  ],
};

// ===================== Rules (auto-generated) =====================
export interface BiomeRule {
  elevation: number[]; // min..max
  moisture: number[];  // min..max
  biomeKey: BiomeKey;
}

// Rich rules = base colors embedded per scheme (so you can avoid looking up Biomes later)
export interface RichBiomeRule extends BiomeRule {
  base: Record<theme, string>;
}

export const richBiomeRules: RichBiomeRule[] = BANDS.flatMap(band =>
  MOISTURE_BY_FAMILY[band.family].map(({ m, key }): RichBiomeRule => ({
    elevation: band.range,
    moisture: m,
    biomeKey: key,
    base: {
      default: Biomes.default[key].color,
      oldAtlas: Biomes.oldAtlas[key].color,
      verdant: Biomes.verdant[key].color,
      rainbow: Biomes.rainbow[key].color,
      ashfall: Biomes.ashfall[key].color,
      winter: Biomes.winter[key].color,
      autumn: Biomes.autumn[key].color,
      greyscale: Biomes.greyscale[key].color,
    },
  }))
);
export const biomeRules: BiomeRule[] = richBiomeRules.map(({ base, ...r }) => r);

// ===================== Theme adjustments (left as-is; optional consumer) =====================
export type ElevationBand = Exclude<BandName, "OCEAN">;

export const BASE_LIGHTNESS: Record<ElevationBand, number> = {
  LOW_1: +0.08, LOW_2: +0.04,
  MEDIUM_1: 0.00, MEDIUM_2: -0.03,
  HIGH_1: -0.06, HIGH_2: -0.10,
  VERY_HIGH: -0.14,
};

export type ThemeAdjust = {
  lightness?: Partial<Record<ElevationBand, number>>;
  saturationScale?: number;
  forceGreyscale?: boolean;
};

export const THEME_OVERRIDES: Record<theme, ThemeAdjust> = {
  default: { saturationScale: 1.0 },
  oldAtlas: {
    lightness: {
      LOW_1: +0.10, LOW_2: +0.05, MEDIUM_2: -0.02, HIGH_1: -0.05, HIGH_2: -0.08, VERY_HIGH: -0.12
    },
    saturationScale: 0.92,
  },
  verdant: {
    lightness: { LOW_1: +0.10, LOW_2: +0.06, MEDIUM_1: +0.01, MEDIUM_2: -0.02, HIGH_1: -0.06, HIGH_2: -0.11, VERY_HIGH: -0.15 },
    saturationScale: 1.07,
  },
  rainbow: {
    saturationScale: 1.12,
    lightness: {
      LOW_1: +0.03, LOW_2: +0.02,
      MEDIUM_1: +0.01, MEDIUM_2: +0.01,
      HIGH_1: -0.02, HIGH_2: -0.04,  // slightly darker up high
      VERY_HIGH: -0.05,              // avoids white-out on peaks
    },
  },
  ashfall: {
    lightness: { LOW_1: +0.04, LOW_2: +0.02, MEDIUM_1: -0.02, MEDIUM_2: -0.05, HIGH_1: -0.10, HIGH_2: -0.14, VERY_HIGH: -0.18 },
    saturationScale: 0.85,
  },
  winter: {
    saturationScale: 0.95, // slightly muted overall
    lightness: {
      HIGH_1: -0.02,
      HIGH_2: -0.03,
      VERY_HIGH: -0.03, // dim peaks just a touch (was too bright)
    },
  },
  autumn: {
    saturationScale: 1.12, // punch up oranges/reds a bit
    lightness: {
      LOW_1: +0.05,
      LOW_2: +0.03,
      MEDIUM_1: +0.02,
      MEDIUM_2: +0.00,
      HIGH_1: -0.02,
      HIGH_2: -0.05,
      VERY_HIGH: -0.06,
    },
  },
  greyscale: { saturationScale: 0.0, forceGreyscale: true },
};
