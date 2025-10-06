export interface Biome {
  color: string,
  greyscale: string,
  name: string,
}

export const Biomes: { [key: string]: Biome } = {
  // Sea
  OCEAN: {
    color: "#44447a",
    greyscale: "#000000",
    name: "ocean"
  },

  // Low
  SUBTROPICAL_DESERT: {
    color: "#d2b98b",
    greyscale: "#2B2B2B",
    name: "subtropical desert"
  },
  GRASSLAND: {
    color: "#88aa55",
    greyscale: "#3F3F3F",
    name: "grassland"
  },
  TROPICAL_SEASONAL_FOREST: {
    color: "#559944",
    greyscale: "#4F4F4F",
    name: "tropical seasonal forest"
  },
  TROPICAL_RAIN_FOREST: {
    color: "#337755",
    greyscale: "#5F5F5F",
    name: "tropical rain forest"
  },

  // Medium
  TEMPERATE_DESERT: {
    color: "#c9d29b",
    greyscale: "#6A6A6A",
    name: "temperate desert"
  },
  DECIDUOUS_FOREST: {
    color: "#679459",
    greyscale: "#7A7A7A",
    name: "deciduous forest"
  },
  TEMPERATE_RAIN_FOREST: {
    color: "#448855",
    greyscale: "#8A8A8A",
    name: "rain forest"
  },

  // High
  SHRUBLAND: {
    color: "#889977",
    greyscale: "#AFAFAF",
    name: "shrubland"
  },
  TAIGA: {
    color: "#99aa77",
    greyscale: "#BFBFBF",
    name: "taiga"
  },

  // Very High
  BARREN_ROCK: {
    color: "#888888",
    greyscale: "#DADADA",
    name: "barren rock"
  },
  TUNDRA: {
    color: "#bbbbaa",
    greyscale: "#EAEAEA",
    name: "tundra"
  },
  GLACIER: {
    color: "#dddde4",
    greyscale: "#FFFFFF",
    name: "glacier"
  }
} as const;

export interface BiomeRule {
  elevation: [number, number]; // min, max
  moisture: [number, number];  // min, max
  biome: Biome,
}

export const VERY_HIGH_ELEVATION: [number, number] = [0.6, 1];
export const HIGH_ELEVATION: [number, number] = [0.4, 0.6];
export const MEDIUM_ELEVATION: [number, number] = [0.2, 0.4];
export const LOW_ELEVATION: [number, number] = [0, 0.2];
export const SEA_ELEVATION: [number, number] = [-1, 0];

export const biomeRules: BiomeRule[] = [
  // Very High
  { elevation: VERY_HIGH_ELEVATION, moisture: [0, 0.2], biome: Biomes.BARREN_ROCK },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.2, 0.5], biome: Biomes.TUNDRA },
  { elevation: VERY_HIGH_ELEVATION, moisture: [0.5, 1], biome: Biomes.GLACIER },

  // High
  { elevation: HIGH_ELEVATION, moisture: [0, 0.33], biome: Biomes.TEMPERATE_DESERT },
  { elevation: HIGH_ELEVATION, moisture: [0.33, 0.66], biome: Biomes.SHRUBLAND },
  { elevation: HIGH_ELEVATION, moisture: [0.66, 1], biome: Biomes.TAIGA },

  // Medium
  { elevation: MEDIUM_ELEVATION, moisture: [0, 0.16], biome: Biomes.TEMPERATE_DESERT },
  { elevation: MEDIUM_ELEVATION, moisture: [0.16, 0.5], biome: Biomes.GRASSLAND },
  { elevation: MEDIUM_ELEVATION, moisture: [0.5, 0.83], biome: Biomes.DECIDUOUS_FOREST },
  { elevation: MEDIUM_ELEVATION, moisture: [0.83, 1], biome: Biomes.TEMPERATE_RAIN_FOREST },

  // Low
  { elevation: LOW_ELEVATION, moisture: [0, 0.16], biome: Biomes.SUBTROPICAL_DESERT },
  { elevation: LOW_ELEVATION, moisture: [0.16, 0.33], biome: Biomes.GRASSLAND },
  { elevation: LOW_ELEVATION, moisture: [0.33, 0.66], biome: Biomes.TROPICAL_SEASONAL_FOREST },
  { elevation: LOW_ELEVATION, moisture: [0.66, 1], biome: Biomes.TROPICAL_RAIN_FOREST },

  // sea
  { elevation: SEA_ELEVATION, moisture: [0, 1], biome: Biomes.OCEAN },
];
