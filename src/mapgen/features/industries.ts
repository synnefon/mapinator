import { type RNG } from "../../common/random";
import type { CityTier } from "./cities";
import { type CityCondition, matchesCondition } from "./cityCondition";
import type { CityContext } from "./cityStats";
import { Authority, Society, Structure, Trait } from "./government";

// ===================== Industry =====================
// Each rule answers one yes/no question: does this industry fit the city (geography + climate + the
// owning government's tags + size + water proximity)? The fit is a declarative `when` condition — the
// same vocabulary fun facts use — not a hand-written predicate. An ARRAY of conditions means "any of
// these" (OR), for industries that fit under more than one distinct circumstance. Among the industries
// that fit, deriveIndustries picks uniformly (no weighting). Maritime industries need a LARGE body of
// water (`coastal`); freshwater ones accept any (`nearWater`). "trade" has no condition, so it always
// fits — even a featureless town lands on something.
type IndustryRule = {
  name: string;
  when?: CityCondition | CityCondition[];
};

const INDUSTRY_RULES: IndustryRule[] = [
  // --- Water & coast (sea = `coastal`; inland water = `nearWater && !coastal`) ---
  { name: "fishing", when: { nearWater: true } },
  { name: "shipping", when: { coastal: true } },
  { name: "shipbuilding", when: [{ coastal: true, bands: ["WET"] }, { coastal: true, families: ["MEDIUM"] }] },
  { name: "river trade", when: { nearWater: true, coastal: false } },
  { name: "salt trade", when: { coastal: true, families: ["LOW"], bands: ["DRY"] } },
  { name: "whaling", when: { coastal: true, minIce: 0.3 } },
  { name: "pearling", when: { coastal: true, families: ["LOW"], maxIce: 0.1 } },
  { name: "amber trade", when: { coastal: true, minIce: 0.2 } },
  { name: "spice trade", when: { coastal: true, families: ["LOW"], anyTags: { authority: [Authority.Commercial] } } },
  { name: "sugar refining", when: { coastal: true, families: ["LOW"], bands: ["WET", "MID"], maxIce: 0.1 } },
  { name: "cartography", when: { coastal: true, anyTags: { society: [Society.Scholastic, Society.Maritime] } } },
  { name: "smuggling", when: { coastal: true, capital: false, anyTags: { authority: [Authority.Commercial] } } },
  { name: "privateering", when: { coastal: true, capital: false, anyTags: { authority: [Authority.Militaristic] } } },
  { name: "pottery", when: { families: ["LOW"], nearWater: true } },
  { name: "canal works", when: { biomes: ["wetland"], anyTags: { structure: [Structure.Urban] } } },

  // --- Farming & herding ---
  {
    name: "agriculture",
    when: [{ families: ["LOW"], bands: ["MID", "WET"] }, { bands: ["MID"] }, { anyTags: { society: [Society.Agrarian] } }],
  },
  { name: "herding", when: [{ bands: ["DRY"], families: ["MEDIUM"] }, { anyTags: { structure: [Structure.Nomadic], society: [Society.Agrarian] } }] },
  { name: "forestry", when: { families: ["MEDIUM"], bands: ["WET", "MID"] } },
  { name: "viticulture", when: { families: ["MEDIUM"], bands: ["MID"], maxElevationMeters: 1200 } },
  { name: "date farming", when: { biomes: ["desert"], nearWater: true } },
  { name: "rice farming", when: { biomes: ["wetland"] } },
  { name: "olive orchards", when: { families: ["LOW"], bands: ["DRY", "MID"], maxElevationMeters: 800 } },
  { name: "linen", when: { families: ["LOW"], bands: ["WET", "MID"] } },
  { name: "beekeeping", when: { families: ["LOW", "MEDIUM"], bands: ["MID", "WET"] } },
  { name: "cheesemaking", when: { families: ["MEDIUM", "HIGH"], bands: ["MID", "WET"] } },
  { name: "brewing", when: { anyTags: { society: [Society.Agrarian] }, bands: ["MID", "WET"] } },
  { name: "distilling", when: { anyTags: { society: [Society.Agrarian] }, minIce: 0.15 } },
  { name: "leatherworking", when: { anyTags: { society: [Society.Agrarian], structure: [Structure.Nomadic] } } },
  { name: "wool", when: { families: ["MEDIUM", "HIGH"], anyTags: { society: [Society.Agrarian], structure: [Structure.Nomadic] } } },
  { name: "tea", when: { families: ["MEDIUM", "HIGH"], bands: ["WET"], minElevationMeters: 600 } },
  { name: "cotton", when: { families: ["LOW"], bands: ["MID", "DRY"], nearWater: true } },

  // --- Climate-driven ---
  { name: "fur trapping", when: { biomes: ["tundra", "snowfields", "montane forest"] } },
  { name: "ice harvesting", when: { minIce: 0.3 } },
  { name: "reindeer herding", when: { biomes: ["tundra", "snowfields"], anyTags: { structure: [Structure.Nomadic] } } },
  { name: "caravan trade", when: { biomes: ["desert", "steppe"], nearWater: false } },
  { name: "incense trade", when: { biomes: ["desert", "steppe"], anyTags: { authority: [Authority.Religious, Authority.Commercial] } } },
  { name: "camel breeding", when: { biomes: ["desert", "steppe"], anyTags: { structure: [Structure.Nomadic] } } },
  { name: "falconry", when: { biomes: ["steppe", "desert"], anyTags: { authority: [Authority.Elite], structure: [Structure.Nomadic] } } },
  { name: "charcoal burning", when: { biomes: ["woodland", "forest", "montane forest"] } },
  { name: "horse breeding", when: { biomes: ["grassland", "steppe"], anyTags: { structure: [Structure.Nomadic], trait: [Trait.Expansionist] } } },

  // --- Mountain & mineral ---
  { name: "mining", when: [{ families: ["HIGH", "VERY_HIGH"] }, { families: ["MEDIUM"], bands: ["DRY"] }] },
  { name: "quarrying", when: { families: ["HIGH"], bands: ["DRY"] } },
  { name: "metalworking", when: { families: ["HIGH", "VERY_HIGH"], anyTags: { society: [Society.Industrial], authority: [Authority.Technical] } } },
  { name: "gemcutting", when: { families: ["HIGH", "VERY_HIGH"], anyTags: { authority: [Authority.Elite, Authority.Commercial] } } },
  { name: "glassblowing", when: [{ biomes: ["desert"] }, { coastal: true, anyTags: { structure: [Structure.Urban] } }] },
  {
    name: "armory",
    when: [
      { tiers: ["medium", "big"], anyTags: { authority: [Authority.Militaristic] } },
      { families: ["HIGH", "VERY_HIGH"], anyTags: { authority: [Authority.Technical] } },
    ],
  },

  // --- Craft & industry ---
  { name: "manufacturing", when: [{ tiers: ["big"] }, { anyTags: { society: [Society.Industrial], authority: [Authority.Technical], structure: [Structure.Urban] } }] },
  { name: "textiles", when: [{ tiers: ["medium", "big"] }, { anyTags: { society: [Society.Industrial, Society.Agrarian] } }] },
  { name: "silk weaving", when: { families: ["LOW", "MEDIUM"], anyTags: { authority: [Authority.Commercial], society: [Society.Industrial] } } },
  { name: "papermaking", when: { nearWater: true, anyTags: { society: [Society.Scholastic] } } },
  { name: "clockmaking", when: { tiers: ["medium", "big"], anyTags: { authority: [Authority.Technical], structure: [Structure.Urban] } } },

  // --- Leisure & travel (period-appropriate destinations/spectacle; cf. `pilgrimage`, `theater`) ---
  { name: "hot springs", when: { families: ["HIGH", "VERY_HIGH"] } },
  { name: "holy festivals", when: { anyTags: { authority: [Authority.Religious], trait: [Trait.Traditional] } } },
  { name: "tournaments", when: { anyTags: { authority: [Authority.Monarchic, Authority.Militaristic] } } },
  { name: "gaming houses", when: { tiers: ["medium", "big"], anyTags: { authority: [Authority.Commercial], structure: [Structure.Urban] } } },
  { name: "minstrelsy", when: { anyTags: { trait: [Trait.Traditional], structure: [Structure.Urban] } } },

  // --- Trade, government & culture ---
  { name: "banking", when: [{ capital: true }, { tiers: ["big"] }, { anyTags: { authority: [Authority.Commercial, Authority.Elite] } }] },
  { name: "scholarship", when: { anyTags: { society: [Society.Scholastic], authority: [Authority.Technical, Authority.Religious] } } },
  { name: "astronomy", when: { families: ["HIGH", "VERY_HIGH"], anyTags: { society: [Society.Scholastic] } } },
  { name: "alchemy", when: { tags: { society: [Society.Scholastic], authority: [Authority.Technical] } } },
  { name: "printing", when: [{ tags: { society: [Society.Scholastic] }, tiers: ["big"] }, { tags: { society: [Society.Scholastic], structure: [Structure.Urban] } }] },
  { name: "theater", when: { tiers: ["big"], anyTags: { structure: [Structure.Urban] } } },
  { name: "pilgrimage", when: { anyTags: { authority: [Authority.Religious] } } },
  { name: "military", when: [{ capital: true }, { anyTags: { authority: [Authority.Militaristic], trait: [Trait.Expansionist] } }] },
  { name: "administration", when: [{ capital: true }, { anyTags: { authority: [Authority.Bureaucratic] } }] },
  { name: "diplomacy", when: { capital: true, anyTags: { authority: [Authority.Bureaucratic, Authority.Elite] } } },
  { name: "mercenary trade", when: { tags: { authority: [Authority.Militaristic, Authority.Commercial] } } },
];

// Industry count grows with city size — smaller cities get fewer.
const INDUSTRY_COUNT: Record<CityTier, number> = { small: 1, medium: 2, big: 3 };

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
export function deriveIndustries(ctx: CityContext): string[] {
  const eligible = INDUSTRY_RULES.filter((r) => matchesCondition(ctx, r.when)).map((r) => r.name);
  return pickUniform(eligible, INDUSTRY_COUNT[ctx.tier], ctx.rng);
}
