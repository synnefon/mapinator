import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import type { CityTier, CityWaterKind } from "./cities";
import type { BiomeName, CityContext } from "./cityStats";
import { type Tags } from "./government";
import type { IndustryTag } from "./industries";

// ===================== City conditions =====================
// A small declarative vocabulary for "does this city match?", shared by both industry rules and fun-fact
// patterns so the two stay in lock-step. A condition is a bag of optional constraints; every constraint
// that's set must hold, and they hold together (AND). Matching lives here, not in the data, so a rule is
// just a value — no hand-written predicate per rule.

export type TagFilter = Partial<Tags>;

/** Optional constraints over a CityContext. Set fields are AND-combined. Array fields (elevations/bands/
 *  biomes/tiers) match if the city's value is ONE OF the listed (OR within the field); `industries`
 *  matches if the city HAS at least one of the listed. Tag filters: `tags` = every named tag present,
 *  `anyTags` = at least one present, `excludeTags` = none present. */
export type CityCondition = {
  tiers?: CityTier[];
  capital?: boolean;

  elevations?: ElevationFamily[];
  bands?: MoistureBand[];
  biomes?: BiomeName[];
  industries?: string[]; // city has AT LEAST ONE of these derived industries (see industries.ts)
  anyIndustryTags?: IndustryTag[]; // city has an industry carrying AT LEAST ONE of these semantic tags

  coastal?: boolean;
  nearWater?: boolean;
  water?: CityWaterKind[]; // the specific water the city sits ON (ocean/river/lake/none) — finer than coastal/nearWater

  minElevationMeters?: number;
  maxElevationMeters?: number;
  minIce?: number;
  maxIce?: number;

  tags?: TagFilter;
  anyTags?: TagFilter;
  excludeTags?: TagFilter;
};

const tagGroups = ["authority", "society", "structure", "trait"] as const;

// Membership over tag arrays. Indexing `Tags` by a key *union* widens each side to a union of arrays;
// typing both as `AnyTag[]` lets `includes` check cleanly (this is what the old `as never` papered over).
type AnyTag = NonNullable<Tags[keyof Tags]>[number];
const hasAll = (found: readonly AnyTag[], wanted: readonly AnyTag[]): boolean => wanted.every((t) => found.includes(t));
const hasAny = (found: readonly AnyTag[], wanted: readonly AnyTag[]): boolean => wanted.some((t) => found.includes(t));

// Every group the filter names is fully present; groups it leaves empty are ignored.
function includesAllTags(actual: Tags, required?: TagFilter): boolean {
  if (!required) return true;
  return tagGroups.every((group) => {
    const wanted = required[group] ?? [];
    return wanted.length === 0 || hasAll(actual[group] ?? [], wanted);
  });
}

// At least one named tag, in any group, is present.
function includesAnyTag(actual: Tags, required?: TagFilter): boolean {
  if (!required) return true;
  return tagGroups.some((group) => {
    const wanted = required[group] ?? [];
    return wanted.length > 0 && hasAny(actual[group] ?? [], wanted);
  });
}

// No named tag, in any group, is present.
function includesNoTags(actual: Tags, excluded?: TagFilter): boolean {
  if (!excluded) return true;
  return tagGroups.every((group) => {
    const banned = excluded[group] ?? [];
    return banned.length === 0 || !hasAny(actual[group] ?? [], banned);
  });
}

function matchesSingle(c: CityContext, when: CityCondition): boolean {
  if (when.capital !== undefined && c.isCapital !== when.capital) return false;
  if (when.tiers && !when.tiers.includes(c.tier)) return false;

  if (when.elevations && !when.elevations.includes(c.family)) return false;
  if (when.bands && !when.bands.includes(c.band)) return false;
  if (when.biomes && !when.biomes.includes(c.biome)) return false;
  if (when.industries && !when.industries.some((n) => c.industries.includes(n))) return false;
  if (when.anyIndustryTags && !when.anyIndustryTags.some((t) => c.industryTags.includes(t))) return false;

  if (when.coastal !== undefined && c.coastal !== when.coastal) return false;
  if (when.nearWater !== undefined && c.nearWater !== when.nearWater) return false;
  if (when.water && !when.water.includes(c.waterKind)) return false;

  if (when.minElevationMeters !== undefined && c.elevationMeters < when.minElevationMeters) return false;
  if (when.maxElevationMeters !== undefined && c.elevationMeters > when.maxElevationMeters) return false;

  if (when.minIce !== undefined && c.ice < when.minIce) return false;
  if (when.maxIce !== undefined && c.ice > when.maxIce) return false;

  if (!tagsMatch(c.govTags, when)) return false;

  return true;
}

/** The tag half of a condition: `tags` (all present) ∧ `anyTags` (≥1 present) ∧ `excludeTags` (none present).
 *  Split out so a given govType's tag set can be tested directly (e.g. the offline combo audit), not only
 *  via a full CityContext. */
export function tagsMatch(govTags: Tags, when: Pick<CityCondition, "tags" | "anyTags" | "excludeTags">): boolean {
  return (
    includesAllTags(govTags, when.tags) &&
    includesAnyTag(govTags, when.anyTags) &&
    includesNoTags(govTags, when.excludeTags)
  );
}

/** Does the context satisfy `when`? `undefined` always matches. An ARRAY is any-of (OR): it matches when
 *  ANY member matches — the declarative way to express "A or B" across dimensions a single condition's
 *  AND-combined fields can't (e.g. coastal AND (wet OR mountainous)). */
export function matchesCondition(c: CityContext, when?: CityCondition | CityCondition[]): boolean {
  if (!when) return true;
  if (Array.isArray(when)) return when.some((w) => matchesSingle(c, w));
  return matchesSingle(c, when);
}
