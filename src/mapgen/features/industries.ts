import { type RNG } from "../../common/random";
import type { SettlementTier } from "./settlements";
import { type CityCondition, matchesCondition } from "./cityCondition";
import type { SettlementContext } from "./cityStats";
import { Authority, Society, Structure, Trait } from "./government";

// ===================== Industry =====================
// Each rule answers one yes/no question: does this industry fit the city (geography + climate + the
// owning government's tags + size + water proximity)? The fit is a declarative `when` condition — the
// same vocabulary fun facts use — not a hand-written predicate. An ARRAY of conditions means "any of
// these" (OR), for industries that fit under more than one distinct circumstance. Among the industries
// that fit, deriveIndustries picks uniformly (no weighting). Maritime industries need a LARGE body of
// water (`coastal`); freshwater ones accept any (`nearWater`). "trade" has no condition, so it always
// fits — even a featureless town lands on something.
// `tags` are the industry's SEMANTIC categories (trade / craft / luxury / water …). Theme- and relation-
// rules gate on these via `anyIndustryTags` instead of re-listing every industry name, so adding an
// industry that's "trade-ish" automatically joins the river_trade / harbor_trade themes with no rule edit.
// This is the whole point of the migration: author against categories, not pairs.
type IndustryRule = {
  name: string;
  tags: IndustryTag[];
  when?: CityCondition | CityCondition[];
};

// Tight, shared vocabulary. Keep it small — a tag earns its place by being something a theme/relation/
// flavour template wants to key off ("any fuel-hungry trade", "any maritime craft"), not a synonym of the name.
export type IndustryTag =
  | "trade" | "transport" | "maritime" | "water" | "fishing" | "shipbuilding"
  | "farming" | "herding" | "pastoral" | "food" | "drink"
  | "timber" | "charcoal" | "fuel_hungry"
  | "mining" | "stone" | "metal" | "extraction"
  | "craft" | "textile" | "luxury" | "export"
  | "scholarly" | "religious" | "military" | "admin" | "leisure" | "cold";

const INDUSTRY_RULES: IndustryRule[] = [
  // --- Water & coast (sea = `coastal`; inland water = `nearWater && !coastal`) ---
  { name: "fishing", tags: ["fishing", "food", "water"], when: { nearWater: true } },
  { name: "shipping", tags: ["trade", "transport", "maritime", "water"], when: { coastal: true } },
  { name: "shipbuilding", tags: ["shipbuilding", "craft", "maritime", "timber"], when: [{ coastal: true, bands: ["WET"] }, { coastal: true, elevations: ["MEDIUM"] }] },
  { name: "river trade", tags: ["trade", "transport", "water"], when: { water: ["river"] } },
  { name: "salt trade", tags: ["trade", "export"], when: { coastal: true, elevations: ["LOW"], bands: ["DRY"] } },
  { name: "whaling", tags: ["fishing", "maritime", "water"], when: { coastal: true, minIce: 0.3 } },
  { name: "pearling", tags: ["luxury", "maritime", "water"], when: { coastal: true, elevations: ["LOW"], maxIce: 0.1 } },
  { name: "clamming", tags: ["fishing", "food", "water"], when: { coastal: true, elevations: ["LOW"] } },
  { name: "amber trade", tags: ["trade", "luxury", "export"], when: { coastal: true, minIce: 0.2 } },
  { name: "spice trade", tags: ["trade", "luxury", "export"], when: { coastal: true, elevations: ["LOW"], anyTags: { authority: [Authority.Commercial] } } },
  { name: "sugar refining", tags: ["craft", "food", "export", "fuel_hungry"], when: { coastal: true, elevations: ["LOW"], bands: ["WET", "MID"], maxIce: 0.1 } },
  { name: "cartography", tags: ["craft", "scholarly", "maritime"], when: { coastal: true, anyTags: { society: [Society.Scholastic, Society.Maritime] } } },
  { name: "smuggling", tags: ["trade", "maritime"], when: { coastal: true, capital: false, anyTags: { authority: [Authority.Commercial] } } },
  { name: "privateering", tags: ["military", "maritime"], when: { coastal: true, capital: false, anyTags: { authority: [Authority.Militaristic] } } },
  { name: "pottery", tags: ["craft"], when: { elevations: ["LOW"], nearWater: true } },
  { name: "canal works", tags: ["craft", "transport", "water"], when: { biomes: ["wetland"], anyTags: { structure: [Structure.Urban] } } },

  // --- River-specific (water-power, crossings, log drives, riverside trades) ---
  { name: "milling", tags: ["craft", "food", "water"], when: { water: ["river"] } },
  { name: "ferrying", tags: ["transport", "water"], when: { water: ["river"] } },
  { name: "timber rafting", tags: ["timber", "transport", "water"], when: { water: ["river"], biomes: ["forest", "woodland", "montane forest"] } },
  { name: "tanning", tags: ["craft", "water"], when: { water: ["river"] } },

  // --- Lake-specific (reeds, fowl, salt pans, freshwater pearls) ---
  { name: "reed harvesting", tags: ["craft", "water"], when: { water: ["lake"] } },
  { name: "fowling", tags: ["food", "water"], when: { water: ["lake"] } },
  { name: "salt panning", tags: ["export", "water"], when: { water: ["lake"], bands: ["DRY"] } },
  { name: "freshwater pearling", tags: ["luxury", "water"], when: { water: ["lake"] } },

  // --- Farming & herding ---
  {
    name: "agriculture",
    tags: ["farming", "food"],
    when: [{ elevations: ["LOW"], bands: ["MID", "WET"] }, { bands: ["MID"] }, { anyTags: { society: [Society.Agrarian] } }],
  },
  { name: "herding", tags: ["herding", "pastoral", "food"], when: [{ bands: ["DRY"], elevations: ["MEDIUM"] }, { anyTags: { structure: [Structure.Nomadic], society: [Society.Agrarian] } }] },
  { name: "forestry", tags: ["timber"], when: { elevations: ["MEDIUM"], bands: ["WET", "MID"] } },
  { name: "viticulture", tags: ["farming", "drink", "luxury"], when: { elevations: ["MEDIUM"], bands: ["MID"], maxElevationMeters: 1200 } },
  { name: "date farming", tags: ["farming", "food"], when: { biomes: ["desert"], nearWater: true } },
  { name: "rice farming", tags: ["farming", "food"], when: { biomes: ["wetland"] } },
  { name: "olive farming", tags: ["farming", "food", "export"], when: { elevations: ["LOW"], bands: ["DRY", "MID"], maxElevationMeters: 800 } },
  { name: "linen", tags: ["textile", "craft"], when: { elevations: ["LOW"], bands: ["WET", "MID"] } },
  { name: "cheesemaking", tags: ["food", "pastoral"], when: { elevations: ["MEDIUM", "HIGH"], bands: ["MID", "WET"] } },
  { name: "brewing", tags: ["drink", "craft"], when: { anyTags: { society: [Society.Agrarian] }, bands: ["MID", "WET"] } },
  { name: "distilling", tags: ["drink", "craft"], when: { anyTags: { society: [Society.Agrarian] }, minIce: 0.15 } },
  { name: "leatherworking", tags: ["craft", "pastoral"], when: { anyTags: { society: [Society.Agrarian], structure: [Structure.Nomadic] } } },
  { name: "wool", tags: ["textile", "pastoral"], when: { elevations: ["MEDIUM", "HIGH"], anyTags: { society: [Society.Agrarian], structure: [Structure.Nomadic] } } },
  { name: "tea", tags: ["farming", "drink", "luxury"], when: { elevations: ["MEDIUM", "HIGH"], bands: ["WET"], minElevationMeters: 600 } },
  { name: "cotton", tags: ["textile", "farming"], when: { elevations: ["LOW"], bands: ["MID", "DRY"], nearWater: true } },

  // --- Climate-driven ---
  { name: "fur trapping", tags: ["pastoral", "luxury", "cold"], when: { biomes: ["tundra", "snowfields", "montane forest"] } },
  { name: "ice harvesting", tags: ["extraction", "cold"], when: { minIce: 0.3 } },
  { name: "reindeer herding", tags: ["herding", "pastoral", "cold"], when: { biomes: ["tundra", "snowfields"], anyTags: { structure: [Structure.Nomadic] } } },
  { name: "caravan trade", tags: ["trade", "transport"], when: { biomes: ["desert", "steppe"], nearWater: false } },
  { name: "incense trade", tags: ["trade", "luxury", "religious"], when: { biomes: ["desert", "steppe"], anyTags: { authority: [Authority.Religious, Authority.Commercial] } } },
  { name: "camel breeding", tags: ["herding", "pastoral", "transport"], when: { biomes: ["desert", "steppe"], anyTags: { structure: [Structure.Nomadic] } } },
  { name: "falconry", tags: ["leisure", "luxury"], when: { biomes: ["steppe", "desert"], anyTags: { authority: [Authority.Elite], structure: [Structure.Nomadic] } } },
  { name: "charcoal burning", tags: ["charcoal", "fuel_hungry", "timber"], when: { biomes: ["woodland", "forest", "montane forest"] } },
  { name: "horse breeding", tags: ["herding", "pastoral", "military"], when: { biomes: ["grassland", "steppe"], anyTags: { structure: [Structure.Nomadic], trait: [Trait.Expansionist] } } },

  // --- Mountain & mineral ---
  { name: "mining", tags: ["mining", "extraction"], when: [{ elevations: ["HIGH", "VERY_HIGH"] }, { elevations: ["MEDIUM"], bands: ["DRY"] }] },
  { name: "quarrying", tags: ["stone", "extraction"], when: { elevations: ["HIGH"], bands: ["DRY"] } },
  { name: "metalworking", tags: ["metal", "craft", "fuel_hungry"], when: { elevations: ["HIGH", "VERY_HIGH"], anyTags: { society: [Society.Industrial], authority: [Authority.Technical] } } },
  { name: "gemcutting", tags: ["luxury", "craft"], when: { elevations: ["HIGH", "VERY_HIGH"], anyTags: { authority: [Authority.Elite, Authority.Commercial] } } },
  { name: "glassblowing", tags: ["craft", "luxury", "export", "fuel_hungry"], when: [{ coastal: true, anyTags: { structure: [Structure.Urban], authority: [Authority.Technical, Authority.Commercial] } }] },
  {
    name: "armory",
    tags: ["metal", "military", "craft"],
    when: [
      { tiers: ["medium", "big"], anyTags: { authority: [Authority.Militaristic] } },
      { elevations: ["HIGH", "VERY_HIGH"], anyTags: { authority: [Authority.Technical] } },
    ],
  },

  // --- Craft & industry ---
  { name: "manufacturing", tags: ["craft", "export"], when: [{ tiers: ["big"] }, { anyTags: { society: [Society.Industrial], authority: [Authority.Technical], structure: [Structure.Urban] } }] },
  { name: "textiles", tags: ["textile", "craft"], when: [{ tiers: ["medium", "big"] }, { anyTags: { society: [Society.Industrial, Society.Agrarian] } }] },
  { name: "silk weaving", tags: ["textile", "luxury", "craft"], when: { elevations: ["LOW", "MEDIUM"], anyTags: { authority: [Authority.Commercial], society: [Society.Industrial] } } },
  { name: "papermaking", tags: ["craft", "scholarly"], when: { nearWater: true, anyTags: { society: [Society.Scholastic] } } },
  { name: "clockmaking", tags: ["craft", "luxury"], when: { tiers: ["medium", "big"], anyTags: { authority: [Authority.Technical], structure: [Structure.Urban] } } },

  // --- Leisure & travel (period-appropriate destinations/spectacle; cf. `pilgrimage`, `theater`) ---
  { name: "hot springs", tags: ["leisure"], when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { name: "holy festivals", tags: ["religious", "leisure"], when: { anyTags: { authority: [Authority.Religious], trait: [Trait.Traditional] } } },
  { name: "tournaments", tags: ["military", "leisure"], when: { anyTags: { authority: [Authority.Monarchic, Authority.Militaristic] } } },
  { name: "gaming houses", tags: ["leisure"], when: { tiers: ["medium", "big"], anyTags: { authority: [Authority.Commercial], structure: [Structure.Urban] } } },
  { name: "minstrelsy", tags: ["leisure"], when: { anyTags: { trait: [Trait.Traditional], structure: [Structure.Urban] } } },
  { name: "gambling", tags: ["leisure"], when: { anyTags: { authority: [Authority.Commercial], structure: [Structure.Urban] } } },

  // --- Trade, government & culture ---
  { name: "banking", tags: ["trade", "luxury"], when: [{ capital: true }, { tiers: ["big"] }, { anyTags: { authority: [Authority.Commercial, Authority.Elite] } }] },
  { name: "scholarship", tags: ["scholarly"], when: { anyTags: { society: [Society.Scholastic], authority: [Authority.Technical, Authority.Religious] } } },
  { name: "astronomy", tags: ["scholarly"], when: { elevations: ["HIGH", "VERY_HIGH"], anyTags: { society: [Society.Scholastic] } } },
  { name: "alchemy", tags: ["scholarly", "craft"], when: { tags: { society: [Society.Scholastic], authority: [Authority.Technical] } } },
  { name: "printing", tags: ["scholarly", "craft"], when: [{ tags: { society: [Society.Scholastic] }, tiers: ["big"] }, { tags: { society: [Society.Scholastic], structure: [Structure.Urban] } }] },
  { name: "theater", tags: ["leisure"], when: { tiers: ["big"], anyTags: { structure: [Structure.Urban] } } },
  { name: "pilgrimage", tags: ["religious"], when: { anyTags: { authority: [Authority.Religious] } } },
  { name: "military", tags: ["military"], when: [{ capital: true }, { anyTags: { authority: [Authority.Militaristic], trait: [Trait.Expansionist] } }] },
  { name: "administration", tags: ["admin"], when: [{ capital: true }, { anyTags: { authority: [Authority.Bureaucratic] } }] },
  { name: "diplomacy", tags: ["admin"], when: { capital: true, anyTags: { authority: [Authority.Bureaucratic, Authority.Elite] } } },
  { name: "mercenary trade", tags: ["military", "trade"], when: { tags: { authority: [Authority.Militaristic, Authority.Commercial] } } },
];

// Every industry name, in rule order — for completeness checks (e.g. the fun-fact flavour guard, which
// requires at least one industry-specific template per industry).
export const INDUSTRY_NAMES: string[] = INDUSTRY_RULES.map((r) => r.name);

// name → its semantic tags, and the union of tags across a set of industries (the city's `industryTags`).
const INDUSTRY_TAGS: Record<string, IndustryTag[]> = Object.fromEntries(INDUSTRY_RULES.map((r) => [r.name, r.tags]));
export function industryTagsOf(names: string[]): IndustryTag[] {
  const tags = new Set<IndustryTag>();
  for (const n of names) for (const t of INDUSTRY_TAGS[n] ?? []) tags.add(t);
  return [...tags];
}

// Industry count grows with city size — smaller cities get fewer.
const INDUSTRY_COUNT: Record<SettlementTier, number> = { small: 1, medium: 2, big: 3 };

/** Up to `count` distinct items drawn uniformly at random from `pool` (partial Fisher–Yates shuffle). */
function pickUniform<T>(pool: T[], count: number, rng: RNG): T[] {
  const arr = pool.slice();
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

/** The city's industries: every rule whose `when` fits its context, then a uniform pick sized by tier
 *  (smaller cities get fewer). `trade` always fits, so a city always gets at least one. Deterministic. */
export function deriveIndustries(ctx: SettlementContext): string[] {
  const eligible = INDUSTRY_RULES.filter((r) => matchesCondition(ctx, r.when)).map((r) => r.name);
  return pickUniform(eligible, INDUSTRY_COUNT[ctx.tier], ctx.rng);
}
