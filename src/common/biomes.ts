export interface Biome {
  name: string;
  color: string;
}

export type ColorScheme =
  | "default"
  | "oldAtlas"
  | "verdant"
  | "ashfall"
  | "greyscale";

export const Biomes: Record<ColorScheme, Record<BiomeKey, Biome>> = {
  // === DEFAULT ===============================================================
  default: {
    OCEAN: { color: "#44447a", name: "ocean" },
    SALT_FLATS: { color: "#e6d7b3", name: "salt flats" },
    SUBTROPICAL_DESERT: { color: "#d2b98b", name: "subtropical desert" },
    SAVANNA: { color: "#a2b34c", name: "savanna" },
    GRASSLAND: { color: "#88aa55", name: "grassland" },
    TROPICAL_DRY_FOREST: { color: "#669944", name: "tropical dry forest" },
    TROPICAL_SEASONAL_FOREST: { color: "#559944", name: "tropical seasonal forest" },
    TROPICAL_RAIN_FOREST: { color: "#337755", name: "tropical rain forest" },
    SWAMP: { color: "#225533", name: "swamp" },
    SEMI_ARID_PLAINS: { color: "#c9d29b", name: "semi-arid plains" },
    TEMPERATE_DESERT: { color: "#d8cfa3", name: "temperate desert" },
    STEPPE: { color: "#aab36b", name: "steppe" },
    PRAIRIE: { color: "#89a55b", name: "prairie" },
    DECIDUOUS_FOREST: { color: "#679459", name: "deciduous forest" },
    MIXED_FOREST: { color: "#557a50", name: "mixed forest" },
    TEMPERATE_RAIN_FOREST: { color: "#448855", name: "temperate rain forest" },
    ALPINE_MEADOW: { color: "#88aa77", name: "alpine meadow" },
    SHRUBLAND: { color: "#889977", name: "shrubland" },
    TAIGA: { color: "#99aa77", name: "taiga" },
    BOREAL_FOREST: { color: "#779966", name: "boreal forest" },
    BARREN_ROCK: { color: "#888888", name: "barren rock" },
    TALUS_SLOPE: { color: "#999999", name: "talus slope" },
    TUNDRA: { color: "#bbbbaa", name: "tundra" },
    PERMAFROST: { color: "#cccccc", name: "permafrost" },
    GLACIER: { color: "#dddde4", name: "glacier" },
  },

  // === OLD ATLAS =============================================================
  oldAtlas: {
    OCEAN: { name: "ocean", color: "#44447a" },
    SALT_FLATS: { name: "salt flats", color: "#F5E6C5" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#D9B67E" },
    SAVANNA: { name: "savanna", color: "#C1B36C" },
    GRASSLAND: { name: "grassland", color: "#A2B079" },
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#7E9A67" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#668A62" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#4C7A67" },
    SWAMP: { name: "swamp", color: "#3E5F54" },
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#CFC29A" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#D8C9A9" },
    STEPPE: { name: "steppe", color: "#B9B080" },
    PRAIRIE: { name: "prairie", color: "#9AA87D" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#6E8B6C" },
    MIXED_FOREST: { name: "mixed forest", color: "#5B7E6B" },
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#486F69" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#97A792" },
    SHRUBLAND: { name: "shrubland", color: "#A8AA95" },
    TAIGA: { name: "taiga", color: "#889A8C" },
    BOREAL_FOREST: { name: "boreal forest", color: "#6C887E" },
    BARREN_ROCK: { name: "barren rock", color: "#A59C8E" },
    TALUS_SLOPE: { name: "talus slope", color: "#B8B0A3" },
    TUNDRA: { name: "tundra", color: "#CEC7B4" },
    PERMAFROST: { name: "permafrost", color: "#E1DDD1" },
    GLACIER: { name: "glacier", color: "#E7E8E9" },
  },

  // === VERDANT ===============================================================
  verdant: {
    OCEAN: { name: "ocean", color: "#174C48" },
    SALT_FLATS: { name: "salt flats", color: "#E6E0C8" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#C4BF4F" },
    SAVANNA: { name: "savanna", color: "#B6D352" },
    GRASSLAND: { name: "grassland", color: "#8BCF75" },
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#6AA36A" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#4E955F" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#3C8C61" },
    SWAMP: { name: "swamp", color: "#24614B" },
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#CFCB7A" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#D4CF89" },
    STEPPE: { name: "steppe", color: "#A1D082" },
    PRAIRIE: { name: "prairie", color: "#82C97B" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#6FAF6F" },
    MIXED_FOREST: { name: "mixed forest", color: "#579B6F" },
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#3C7E69" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#A5C4B7" },
    SHRUBLAND: { name: "shrubland", color: "#7FA585" },
    TAIGA: { name: "taiga", color: "#2F776C" },
    BOREAL_FOREST: { name: "boreal forest", color: "#3F7F6E" },
    BARREN_ROCK: { name: "barren rock", color: "#8AA39E" },
    TALUS_SLOPE: { name: "talus slope", color: "#9EB6A9" },
    TUNDRA: { name: "tundra", color: "#B3CBB9" },
    PERMAFROST: { name: "permafrost", color: "#DDE7E2" },
    GLACIER: { name: "glacier", color: "#E7EFEA" },
  },

  // === ASHFALL ===============================================================
  ashfall: {
    OCEAN: { name: "ocean", color: "#2A2A2C" },
    SALT_FLATS: { name: "salt flats", color: "#9A9189" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#7A5E4D" },
    SAVANNA: { name: "savanna", color: "#7A6A5C" },
    GRASSLAND: { name: "grassland", color: "#726C65" },
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#6F665E" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#5F5A54" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#55524E" },
    SWAMP: { name: "swamp", color: "#494644" },
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#6C635C" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#7F746A" },
    STEPPE: { name: "steppe", color: "#6F6862" },
    PRAIRIE: { name: "prairie", color: "#756E67" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#7A736E" },
    MIXED_FOREST: { name: "mixed forest", color: "#6D6761" },
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#86796E" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#AAA398" },
    SHRUBLAND: { name: "shrubland", color: "#6E625C" },
    TAIGA: { name: "taiga", color: "#99938C" },
    BOREAL_FOREST: { name: "boreal forest", color: "#8B857F" },
    BARREN_ROCK: { name: "barren rock", color: "#8E8983" },
    TALUS_SLOPE: { name: "talus slope", color: "#A39E98" },
    TUNDRA: { name: "tundra", color: "#C2BEB8" },
    PERMAFROST: { name: "permafrost", color: "#D0CCC7" },
    GLACIER: { name: "glacier", color: "#E5E3E0" },
  },

  // === GREYSCALE =============================================================
  greyscale: {
    OCEAN: { name: "ocean", color: "#111111" },
    SALT_FLATS: { name: "salt flats", color: "#262626" },
    SUBTROPICAL_DESERT: { name: "subtropical desert", color: "#2B2B2B" },
    SAVANNA: { name: "savanna", color: "#383838" },
    GRASSLAND: { name: "grassland", color: "#3F3F3F" },
    TROPICAL_DRY_FOREST: { name: "tropical dry forest", color: "#484848" },
    TROPICAL_SEASONAL_FOREST: { name: "tropical seasonal forest", color: "#4F4F4F" },
    TROPICAL_RAIN_FOREST: { name: "tropical rain forest", color: "#5F5F5F" },
    SWAMP: { name: "swamp", color: "#585858" },
    SEMI_ARID_PLAINS: { name: "semi-arid plains", color: "#616161" },
    TEMPERATE_DESERT: { name: "temperate desert", color: "#6A6A6A" },
    STEPPE: { name: "steppe", color: "#717171" },
    PRAIRIE: { name: "prairie", color: "#757575" },
    DECIDUOUS_FOREST: { name: "deciduous forest", color: "#7A7A7A" },
    MIXED_FOREST: { name: "mixed forest", color: "#838383" },
    TEMPERATE_RAIN_FOREST: { name: "temperate rain forest", color: "#8A8A8A" },
    ALPINE_MEADOW: { name: "alpine meadow", color: "#9E9E9E" },
    SHRUBLAND: { name: "shrubland", color: "#AFAFAF" },
    TAIGA: { name: "taiga", color: "#BFBFBF" },
    BOREAL_FOREST: { name: "boreal forest", color: "#B7B7B7" },
    BARREN_ROCK: { name: "barren rock", color: "#DADADA" },
    TALUS_SLOPE: { name: "talus slope", color: "#D5D5D5" },
    TUNDRA: { name: "tundra", color: "#EAEAEA" },
    PERMAFROST: { name: "permafrost", color: "#F5F5F5" },
    GLACIER: { name: "glacier", color: "#FFFFFF" },
  },
};

export const BiomeKeys = [
  "OCEAN",
  "SALT_FLATS",
  "SUBTROPICAL_DESERT",
  "SAVANNA",
  "GRASSLAND",
  "TROPICAL_DRY_FOREST",
  "TROPICAL_SEASONAL_FOREST",
  "TROPICAL_RAIN_FOREST",
  "SWAMP",
  "SEMI_ARID_PLAINS",
  "TEMPERATE_DESERT",
  "STEPPE",
  "PRAIRIE",
  "DECIDUOUS_FOREST",
  "MIXED_FOREST",
  "TEMPERATE_RAIN_FOREST",
  "ALPINE_MEADOW",
  "SHRUBLAND",
  "TAIGA",
  "BOREAL_FOREST",
  "BARREN_ROCK",
  "TALUS_SLOPE",
  "TUNDRA",
  "PERMAFROST",
  "GLACIER",
] as const;

// 👇 this line extracts the literal union type
export type BiomeKey = typeof BiomeKeys[number];


export interface BiomeRule {
  elevation: [number, number]; // min..max
  moisture: [number, number];  // min..max
  biomeKey: BiomeKey;          // <-- key, not object
}

// ELEVATION ZONES
export const VERY_HIGH_ELEVATION: [number, number] = [0.6, 1];
export const HIGH_ELEVATION: [number, number] = [0.45, 0.6];
export const MEDIUM_ELEVATION: [number, number] = [0.25, 0.45];
export const LOW_ELEVATION: [number, number] = [0, 0.25];

// SEA DEPTH ZONES
// export const DEEP_SEA: [number, number] = [-1.0, -0.6];
export const OCEAN: [number, number] = [-1, 0];
// export const COASTAL_SEA: [number, number] = [-0.3, -0.1];
// export const SHALLOWS_ZONE: [number, number] = [-0.1, 0];
// export const REEF_ZONE: [number, number] = [-0.03, 0]; // just below land

export const biomeRules: BiomeRule[] = [
  // SEA — single ocean, depth-only
  { elevation: OCEAN, moisture: [0, 1], biomeKey: "OCEAN" },

  // VERY HIGH
  { elevation: VERY_HIGH_ELEVATION, moisture: [0, 0.15], biomeKey: "BARREN_ROCK" },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.15, 0.35], biomeKey: "TALUS_SLOPE" },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.35, 0.6], biomeKey: "TUNDRA" },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.6, 0.8], biomeKey: "PERMAFROST" },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.8, 1], biomeKey: "GLACIER" },

  // HIGH
  { elevation: HIGH_ELEVATION, moisture: [0, 0.25], biomeKey: "TEMPERATE_DESERT" },
  { elevation: HIGH_ELEVATION, moisture: [0.25, 0.45], biomeKey: "SHRUBLAND" },
  { elevation: HIGH_ELEVATION, moisture: [0.45, 0.65], biomeKey: "ALPINE_MEADOW" },
  { elevation: HIGH_ELEVATION, moisture: [0.65, 0.85], biomeKey: "TAIGA" },
  { elevation: HIGH_ELEVATION, moisture: [0.85, 1], biomeKey: "BOREAL_FOREST" },

  // MEDIUM
  { elevation: MEDIUM_ELEVATION, moisture: [0, 0.15], biomeKey: "SEMI_ARID_PLAINS" },
  { elevation: MEDIUM_ELEVATION, moisture: [0.15, 0.3], biomeKey: "STEPPE" },
  { elevation: MEDIUM_ELEVATION, moisture: [0.3, 0.45], biomeKey: "PRAIRIE" },
  { elevation: MEDIUM_ELEVATION, moisture: [0.45, 0.65], biomeKey: "DECIDUOUS_FOREST" },
  { elevation: MEDIUM_ELEVATION, moisture: [0.65, 0.85], biomeKey: "MIXED_FOREST" },
  { elevation: MEDIUM_ELEVATION, moisture: [0.85, 1], biomeKey: "TEMPERATE_RAIN_FOREST" },

  // LOW
  { elevation: LOW_ELEVATION, moisture: [0, 0.1], biomeKey: "SALT_FLATS" },
  { elevation: LOW_ELEVATION, moisture: [0.1, 0.25], biomeKey: "SUBTROPICAL_DESERT" },
  { elevation: LOW_ELEVATION, moisture: [0.25, 0.45], biomeKey: "SAVANNA" },
  { elevation: LOW_ELEVATION, moisture: [0.45, 0.6], biomeKey: "GRASSLAND" },
  { elevation: LOW_ELEVATION, moisture: [0.6, 0.75], biomeKey: "TROPICAL_DRY_FOREST" },
  { elevation: LOW_ELEVATION, moisture: [0.75, 0.9], biomeKey: "TROPICAL_SEASONAL_FOREST" },
  { elevation: LOW_ELEVATION, moisture: [0.9, 1], biomeKey: "SWAMP" },
];
