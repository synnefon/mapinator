export interface BiomeConfig {
  color: string,
  name: string,
}

export const Biomes: { [key: string]: BiomeConfig } = {
  OCEAN: { color: "#44447a", name: "ocean" },
  BARREN_ROCK: { color: "#888888", name: "barren rock" },
  TUNDRA: { color: "#bbbbaa", name: "tundra" },
  GLACIER: { color: "#dddde4", name: "glacier" },
  TEMPERATE_DESERT: { color: "#c9d29b", name: "temperate desert" },
  SHRUBLAND: { color: "#889977", name: "shrubland" },
  TAIGA: { color: "#99aa77", name: "taiga" },
  GRASSLAND: { color: "#88aa55", name: "grassland" },
  DECIDUOUS_FOREST: { color: "#679459", name: "deciduous forest" },
  TEMPERATE_RAIN_FOREST: { color: "#448855", name: "rain forest" },
  SUBTROPICAL_DESERT: { color: "#d2b98b", name: "subtropical desert" },
  TROPICAL_SEASONAL_FOREST: { color: "#559944", name: "tropical seasonal forest" },
  TROPICAL_RAIN_FOREST: { color: "#337755", name: "tropical rain forest" }
} as const;

export type Biome = typeof Biomes[keyof typeof Biomes];

export interface BiomeRule {
  elevation: [number, number]; // min, max
  moisture: [number, number];  // min, max
  biome: BiomeConfig,
}

export const VERY_HIGH_ELEVATION: [number, number] = [0.6, 1];
export const HIGH_ELEVATION: [number, number] = [0.4, 0.6];
export const MEDIUM_ELEVATION: [number, number] = [0.2, 0.4];
export const LOW_ELEVATION: [number, number] = [0, 0.2];
export const sea_ELEVATION: [number, number] = [-1, 0];

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
  { elevation: sea_ELEVATION, moisture: [0, 1], biome: Biomes.OCEAN },
];

