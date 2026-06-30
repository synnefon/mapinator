import { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { makeRNG, type RNG } from "../../common/random";
import { POPULATION } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import type { NameGenerator } from "../NameGenerator";
import { PLANET_RADIUS_KM, type Country } from "./countries";
import { generateFunFact } from "./funFact";
import { type Tags } from "./government";
import { deriveIndustries, industryTagsOf, type IndustryTag } from "./industries";
import {
  type Settlement,
  type SettlementTier,
  type SettlementWaterKind,
  globalCityMinPop,
  growSettlements,
  minLevelForPopulation,
  type PlacedSite,
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

// ===================== Marker assembly (shared by the head + the tail) =====================
// A placed PlacedSite (from the one engine) becomes a Settlement marker the SAME way whether it's a big city
// (the head, assembled here) or a small town (the tail, assembled in RegionTownLayer): same tier rule, same
// profile, same zoom-reveal. Only the NAME differs — unique-by-index for the head, stable-by-location for
// the tail — so the caller generates it and passes it in.

// SettlementTier grounded in ~1400 sizes: a handful of "great cities" (≳75k), a band of sizeable towns, and
// many small market towns. The capital is always big (politically primary). Tier drives the marker class +
// flavour gating — NOT the size NOUN (settlementClass) nor the reveal level (minLevelForPopulation).
const BIG_POP = 75_000;
const MEDIUM_POP = 20_000;

// The big-city HEAD is the settlement field scanned over the WHOLE sphere at/above the global split. These
// two set its global count + spread: a COARSER grid or a LARGER per-capita ⇒ fewer big cities. The accept ∝
// density keeps them where people are (coasts/rivers/fertile land); the size law decides which clear the
// split. The dense sub-split tail is the patch-local town layer (RegionTownLayer) — the SAME field at a finer
// grid over the view — so head and tail meet at globalCityMinPop with no gap or overlap.
const HEAD_GRID_ANGLE = 0.012; // ~0.7° candidate spacing for the global big-city scan
const HEAD_PER_CAPITA = 100_000; // people per big-city candidate — the head's density target (tune for count)

// A country the coarse head scan missed (its largest settlement falls below the split) still gets a capital:
// a FINE scan over just that country's region finds its actual largest settlement — engine-placed on its
// water like any other — and promotes THAT, rather than stranding a synthetic capital at the inland anchor.
// Cheap: each is a small cap. Falls back to the anchor only if the country has no habitable site at all.
const CAPITAL_SCAN_GRID = 0.004;
const CAPITAL_SCAN_PER_CAPITA = 4_000;

const siteVec = (sites: Float32Array, cell: number): Vec3 => ({ x: sites[3 * cell], y: sites[3 * cell + 1], z: sites[3 * cell + 2] });

/** Marker size class by population — the capital is always "big". */
export const tierOf = (population: number, isCapital: boolean): SettlementTier =>
  isCapital || population >= BIG_POP ? "big" : population >= MEDIUM_POP ? "medium" : "small";

/** Build ONE Settlement marker from a placed site + its country. Shared by the head (assembleHeadSettlements)
 *  and the tail (RegionTownLayer): a big city and a small town are assembled identically. `name` + `statsRng`
 *  come from the caller (head names are unique by index; tail names stable by location). */
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
 * Place + assemble the world's big cities: the settlement field (settlements.ts) scanned over the WHOLE
 * sphere, emitting every settlement at/above the global split (globalCityMinPop). Identical engine, routes,
 * and water-snapping as the patch-local town tail — there is no separate "city placement" any more. Each
 * country's LARGEST result is its CAPITAL (forced onto the globe at zoom 1); a country the coarse scan missed
 * gets one synthesised at its interior anchor, so every populated country keeps a capital. Deterministic.
 */
export function assembleHeadSettlements(args: {
  map: GlobeMap;
  seaLevel: number;
  world: SettlementWorld;
  countries: Country[];
  mapSeed: string;
  namer: NameGenerator;
}): Settlement[] {
  const { map, seaLevel, world, countries, mapSeed, namer } = args;
  const cityMinPop = globalCityMinPop(POPULATION.GLOBAL_POPULATION_DENSITY.value);
  // The big-city HEAD: the field over the whole sphere, only settlements ≥ the split. Centre is arbitrary
  // (capAngle ≥ π is the whole sphere); the field is global-cell-id keyed, so it's the same set every time.
  const head = growSettlements({
    center: { x: 1, y: 0, z: 0 },
    capAngle: Math.PI,
    gridAngle: HEAD_GRID_ANGLE,
    minPop: cityMinPop,
    ceilingPop: Infinity,
    perCapita: HEAD_PER_CAPITA,
    planetRadiusKm: PLANET_RADIUS_KM,
    world,
    seed: `${mapSeed}|cities`,
  });

  // Group by country, largest first — the largest is the capital.
  const byCountry: PlacedSite[][] = countries.map(() => []);
  for (const s of head) if (s.countryIndex >= 0 && s.countryIndex < countries.length) byCountry[s.countryIndex].push(s);
  for (const list of byCountry) list.sort((a, b) => b.population - a.population);

  const settlements: Settlement[] = [];
  for (const country of countries) {
    const list = byCountry[country.index];
    // A country the coarse scan missed still gets a capital: find its LARGEST settlement by a fine scan over
    // its own region and promote that (engine-placed on its water). Fall back to the interior anchor only if
    // the country has no habitable site at all.
    if (list.length === 0) {
      const center = siteVec(map.sites, country.anchorCell);
      const local = growSettlements({
        center,
        capAngle: Math.max(country.extent, CAPITAL_SCAN_GRID * 4),
        gridAngle: CAPITAL_SCAN_GRID,
        minPop: 1,
        ceilingPop: Infinity,
        perCapita: CAPITAL_SCAN_PER_CAPITA,
        planetRadiusKm: PLANET_RADIUS_KM,
        world,
        seed: `${mapSeed}|capital|${country.index}`,
      }).filter((s) => s.countryIndex === country.index);
      if (local.length > 0) {
        list.push(local.reduce((a, b) => (b.population > a.population ? b : a)));
      } else {
        const f = world.fieldAt(center);
        const { anchor, waterKind } = world.routeAt(center);
        list.push({ anchor, population: Math.round(cityMinPop), countryIndex: country.index, waterKind, ...f });
      }
    }
    const usedFunFacts = new Set<string>(); // dedupe fun facts within this country
    list.forEach((s, idx) => {
      const isCapital = idx === 0; // the country's largest settlement
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
