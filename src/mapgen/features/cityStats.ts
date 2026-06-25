import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import { type RNG } from "../../common/random";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { CityTier } from "./cities";
import { generateFunFact } from "./funFact";
import { type Tags } from "./government";
import { deriveIndustries } from "./industries";


// Mount Everest anchors the top of the scale: a cell at the maximum normalised elevation (1.0) reads
// as Everest's peak, sea level reads as 0 m, and everything in between scales linearly. Cities sit on
// LOW/MEDIUM ground (placement keeps them off peaks), so in practice these come out realistically modest.
const EVEREST_M = 8849;
const ELEV_ROUND_M = 10; // round to the nearest 10 m — the field is procedural, so finer is false precision

/** Real-world-ish elevation in metres for a land cell, from its normalised height above sea level. */
export function elevationMeters(rawElevation: number, seaLevel: number): number {
  const frac = Math.max(0, Math.min(1, (rawElevation - seaLevel) / Math.max(1e-6, 1 - seaLevel)));
  return Math.round((frac * EVEREST_M) / ELEV_ROUND_M) * ELEV_ROUND_M;
}

export type BiomeName =
  | "desert" | "grassland" | "wetland"
  | "steppe" | "woodland" | "forest"
  | "badlands" | "highlands" | "montane forest"
  | "barren peaks" | "alpine" | "snowfields"
  | "tundra";

/** A human-readable biome from the same elevation family + moisture band the renderer colours by
 *  (plus an ice override). Used for the fun-fact flavour text; industry keys off the raw signals. */
export function biomeName(family: ElevationFamily, band: MoistureBand, ice: number): BiomeName {
  if (ice > 0.5) return "tundra";
  switch (family) {
    case "LOW": return band === "DRY" ? "desert" : band === "WET" ? "wetland" : "grassland";
    case "MEDIUM": return band === "DRY" ? "steppe" : band === "WET" ? "forest" : "woodland";
    case "HIGH": return band === "DRY" ? "badlands" : band === "WET" ? "montane forest" : "highlands";
    case "VERY_HIGH": return band === "DRY" ? "barren peaks" : band === "WET" ? "snowfields" : "alpine";
    default: return "grassland"; // OCEAN never reaches here (cities are land); keep the switch total
  }
}

/** Everything industry + fun-fact generation reads — one shared shape so both stay in lock-step and
 *  new generators can be added without re-plumbing their inputs. Deterministic via the seeded `rng`. */
export type CityContext = {
  population: number;
  tier: CityTier;
  isCapital: boolean;
  elevationMeters: number;
  family: ElevationFamily;
  band: MoistureBand;
  ice: number;
  biome: BiomeName;
  coastDist: number; // graph hops to the nearest water of any kind; -1 if the cell itself is water
  seaDist: number; // graph hops to the nearest LARGE body of water (sea/ocean); -1 if none reachable
  coastal: boolean; // the cell TOUCHES a large body of water (the sea) — gates maritime industry + flavour
  nearWater: boolean; // the cell TOUCHES water of any kind (lakes, rivers included)
  govTags: Tags; // the owning country's government's semantic tags
  countryName: string;
  rng: RNG;
};

// ===================== One-stop profile =====================
/**
 * Compute the displayable extras for one city: its elevation (m), 1–3 industries, and a fun fact.
 * Builds the shared CityContext from the city's terrain cell + owning country, so industry and fun fact
 * read identical inputs. `rng` must be seeded per city (independent of placement) for determinism.
 */
export function cityProfile(args: {
  rawElevation: number; // RENDERED elevation → biome family/band (the green-band terrain type)
  reportElevation?: number; // display elevation w/ inland relief restored → the shown METRES (falls back to rawElevation)
  moisture: number;
  rainfall: number;
  ice: number;
  seaLevel: number;
  coastDist: number;
  seaDist: number;
  population: number;
  tier: CityTier;
  isCapital: boolean;
  govTags: Tags;
  countryName: string;
  usedFunFacts?: Set<string>; // fun facts already used by this country, so its cities don't repeat one
  rng: RNG;
}): { elevationMeters: number; industries: string[]; funFact: string } {
  // Terrain TYPE (family/band → industries, biome fun-facts) keys off the RENDERED elevation so a flat
  // plains city stays LOW/grassland; only the shown METRES use reportElevation, which varies inland.
  const tc = terrainClassOf(args.rawElevation, args.moisture, args.rainfall);
  const family: ElevationFamily = tc?.family ?? "LOW";
  const band: MoistureBand = tc?.band ?? "MID";
  const meters = elevationMeters(args.reportElevation ?? args.rawElevation, args.seaLevel);
  const ctx: CityContext = {
    population: args.population,
    tier: args.tier,
    isCapital: args.isCapital,
    elevationMeters: meters,
    family,
    band,
    ice: args.ice,
    biome: biomeName(family, band, args.ice),
    coastDist: args.coastDist,
    seaDist: args.seaDist,
    coastal: args.seaDist === 0,
    nearWater: args.coastDist === 0,
    govTags: args.govTags,
    countryName: args.countryName,
    rng: args.rng,
  };
  return { elevationMeters: meters, industries: deriveIndustries(ctx), funFact: generateFunFact(ctx, args.usedFunFacts) };
}
