import { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { makeRNG, type RNG } from "../../common/random";
import { CITIES } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import type { NameGenerator } from "../NameGenerator";
import { type Country } from "./countries";
import { generateFunFact } from "./funFact";
import { type Tags } from "./government";
import { deriveIndustries, industryTagsOf, type IndustryTag } from "./industries";
import {
  type Settlement,
  type SettlementTier,
  type SettlementWaterKind,
  finishSettlements,
  minLevelForPopulation,
  placeSettlements,
  type PlacedCandidate,
  type PlacedSite,
  type RankSizeDials,
  rankSizePopulations,
  type SettlementWorld,
} from "./settlements";


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
export type SettlementContext = {
  population: number;
  tier: SettlementTier;
  isCapital: boolean;
  elevationMeters: number;
  family: ElevationFamily;
  band: MoistureBand;
  ice: number;
  biome: BiomeName;
  coastDist: number; // graph hops to the nearest water of any kind; -1 if the cell itself is water
  seaDist: number; // graph hops to the nearest LARGE body of water (sea/ocean); -1 if none reachable
  coastal: boolean; // the cell TOUCHES a large body of water (the sea) — gates maritime industry + flavour
  nearWater: boolean; // by water of any kind: the cell touches a lake/sea OR sits within reach of a LARGE river
  waterKind: SettlementWaterKind; // the specific water the city sits ON (ocean/river/lake/none) — the river/lake flavour split
  govTags: Tags; // the owning country's government's semantic tags
  industries: string[]; // the city's derived industries; populated before generateFunFact so facts can gate on them
  industryTags: IndustryTag[]; // the union of those industries' semantic tags — what `anyIndustryTags` gates on
  countryName: string;
  rng: RNG;
};

// ===================== One-stop profile =====================
/**
 * Compute the displayable extras for one city: its elevation (m), 1–3 industries, and a fun fact.
 * Builds the shared SettlementContext from the city's terrain cell + owning country, so industry and fun fact
 * read identical inputs. `rng` must be seeded per city (independent of placement) for determinism.
 */
export function settlementProfile(args: {
  rawElevation: number; // RENDERED elevation → biome family/band (the green-band terrain type)
  reportElevation?: number; // display elevation w/ inland relief restored → the shown METRES (falls back to rawElevation)
  moisture: number;
  rainfall: number;
  ice: number;
  seaLevel: number;
  coastDist: number;
  seaDist: number;
  waterKind: SettlementWaterKind; // the water the city sits ON (ocean/river/lake/none) — drives coastal/nearWater + the river/lake split
  population: number;
  tier: SettlementTier;
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
  const ctx: SettlementContext = {
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
    coastal: args.waterKind === "ocean",
    nearWater: args.waterKind !== "none",
    waterKind: args.waterKind,
    govTags: args.govTags,
    industries: [],
    industryTags: [],
    countryName: args.countryName,
    rng: args.rng,
  };
  // Industries first, then fold them (and their semantic tags) into the context so fun facts can gate on
  // the city's ACTUAL trades — both by name (`industries`) and by category (`anyIndustryTags`).
  const industries = deriveIndustries(ctx);
  ctx.industries = industries;
  ctx.industryTags = industryTagsOf(industries);
  return { elevationMeters: meters, industries, funFact: generateFunFact(ctx, args.usedFunFacts) };
}

// ===================== Marker assembly =====================
// A placed PlacedSite (from the one engine) becomes a Settlement marker the SAME way whether it's a capital, a
// big city, or a small town: same tier rule, same profile, same zoom-reveal (minLevel by population). The
// caller generates the (globally unique) name and passes it in.

// SettlementTier grounded in ~1400 sizes: a handful of "great cities" (≳75k), a band of sizeable towns, and
// many small market towns. The capital is always big (politically primary). Tier drives the marker class +
// flavour gating — NOT the size NOUN (settlementClass) nor the reveal level (minLevelForPopulation).
const BIG_POP = 75_000;
const MEDIUM_POP = 20_000;

// Every settlement — capital, big city, small town — comes from the ONE continuous rank-size law per country
// (settlements.rankSizePopulations + placeSettlements), assembled here into markers. No scale ladder, no global
// top-N cut, no separate town algorithm: a country's count + sizes fall out of its population, and the ranks
// are placed on its most habitable, well-spaced land. Zoom reveal is the marker's minLevel (by population).

const siteVec = (sites: Float32Array, cell: number): Vec3 => ({ x: sites[3 * cell], y: sites[3 * cell + 1], z: sites[3 * cell + 2] });

/** Marker size class by population — the capital is always "big". */
export const tierOf = (population: number, isCapital: boolean): SettlementTier =>
  isCapital || population >= BIG_POP ? "big" : population >= MEDIUM_POP ? "medium" : "small";

/** Build ONE Settlement marker from a placed site + its country — capital, big city, and small town are all
 *  assembled identically. `name` + `statsRng` come from the caller (name is unique per settlement). */
export function buildSettlement(
  s: PlacedSite,
  country: { index: number; name: string; govTags: Tags },
  opts: { name: string; isCapital: boolean; seaLevel: number; rainfall: number; statsRng: RNG; usedFunFacts: Set<string> }
): Settlement {
  const tier = tierOf(s.population, opts.isCapital);
  const profile = settlementProfile({
    rawElevation: s.rawElevation,
    reportElevation: s.reportElevation,
    moisture: s.moisture,
    rainfall: opts.rainfall,
    ice: s.ice,
    seaLevel: opts.seaLevel,
    coastDist: s.coastDist,
    seaDist: s.seaDist,
    waterKind: s.waterKind,
    population: s.population,
    tier,
    isCapital: opts.isCapital,
    govTags: country.govTags,
    countryName: country.name,
    usedFunFacts: opts.usedFunFacts,
    rng: opts.statsRng,
  });
  return {
    name: opts.name,
    anchor: s.anchor,
    cell: s.cell, // the land cell it was accepted on (settlements.ts fieldAt) — valid even for snapped coastal anchors
    population: s.population,
    tier,
    isCapital: opts.isCapital,
    minLevel: opts.isCapital ? 1 : minLevelForPopulation(s.population), // capital always on the globe (zoom 1)
    countryIndex: country.index,
    countryName: country.name,
    industries: profile.industries,
    elevationMeters: profile.elevationMeters,
    funFact: profile.funFact,
    waterKind: s.waterKind,
  };
}

/**
 * Place + assemble EVERY country's settlements from the ONE continuous rank-size law. For each country: derive
 * its settlement populations from its total population (settlements.rankSizePopulations — the capital down to
 * the smallest town, growing + lengthening continuously with population), place them on its most habitable,
 * well-spaced land (settlements.placeSettlements — keeping all the coast / river / anti-desert / anti-ice
 * bias), and assemble each into a marker (buildSettlement). The capital is the country's largest (rank 0),
 * forced onto the globe at zoom 1; the rest reveal on zoom by population (minLevel). Global density flows in
 * through each country's population. Deterministic; cached with the map (mapDerivations).
 */
export function assembleCities(args: {
  map: GlobeMap;
  seaLevel: number;
  world: SettlementWorld;
  countries: Country[];
  countryOf: Int32Array; // land partition (cell → country index, -1 = water): the cells each country places on
  mapSeed: string;
  namer: NameGenerator;
}): Settlement[] {
  const { map, seaLevel, world, countries, countryOf, mapSeed, namer } = args;
  const dials: RankSizeDials = {
    largestCityShare: CITIES.LARGEST_CITY_SHARE.value,
    rankFalloff: CITIES.RANK_FALLOFF.value,
    minCityPop: CITIES.MIN_CITY_POP.value,
    maxCities: CITIES.MAX_CITIES.value,
  };
  const spacingCells = CITIES.SPACING.value;
  const spread = CITIES.SPREAD.value;
  const sizeJitter = CITIES.SIZE_JITTER.value;
  const cellSpacingRad = Math.sqrt((4 * Math.PI) / map.cellCount);
  // Bucket the land partition by country — the cells each country's settlements are placed on.
  const cellsByCountry: number[][] = countries.map(() => []);
  for (let c = 0; c < countryOf.length; c++) {
    const ci = countryOf[c];
    if (ci >= 0 && ci < countries.length) cellsByCountry[ci].push(c);
  }

  const settlements: Settlement[] = [];
  for (const country of countries) {
    const cells = cellsByCountry[country.index];
    if (cells.length === 0) continue; // no land cell (shouldn't happen) → nothing to place
    // The whole rank-size curve for this country, then placed on its best, well-spaced land (largest first).
    const populations = rankSizePopulations(country.population, dials);
    const placed: PlacedCandidate[] = placeSettlements({
      cells,
      siteOf: (cell) => siteVec(map.sites, cell),
      world,
      countryIndex: country.index,
      populations,
      spacingCells,
      spread,
      sizeJitter,
      cellSpacingRad,
      seed: `${mapSeed}|city|${country.index}`,
    });
    const sites: PlacedSite[] = finishSettlements(placed, world);
    const usedFunFacts = new Set<string>(); // dedupe fun facts within this country
    sites.forEach((s, idx) => {
      const isCapital = idx === 0; // placeSettlements returns largest first → rank 0 is the capital
      const name = namer.generate({ seed: `${mapSeed}|city|${country.index}|${idx}`, lang: country.language, unique: true });
      settlements.push(
        buildSettlement(s, { index: country.index, name: country.name, govTags: country.govType.tags }, {
          name,
          isCapital,
          seaLevel,
          rainfall: map.rainfall,
          statsRng: makeRNG(`${mapSeed}|city-stats|${country.index}|${idx}`),
          usedFunFacts,
        })
      );
    });
  }
  return settlements;
}
