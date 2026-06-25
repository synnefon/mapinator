import type { ElevationFamily, MoistureBand } from "../../common/biomes";
import type { CityTier } from "./cities";
import { type CityCondition, tagsMatch } from "./cityCondition";
import { biomeName, type CityContext } from "./cityStats";
import { FUN_FACT_PATTERNS, GrammaticalNumber, acceptsQualifier, acceptsSubject, type FactPart, inflect, renderTemplate } from "./funFact";
import { GOV_TYPES } from "./government";

// Offline audit support: enumerate every fun fact a city could ever show, so the combos can be eyeballed
// for nonsense. The only subtlety is reachability — a subject gated to mountains and a qualifier gated to
// coasts never co-occur — so combos are kept only when their slot `when`s are JOINTLY satisfiable by one
// real city. Terrain (family × band × ice → biome) is enumerated because biome is a function of the three;
// every other axis factors independently. Government tags use the REAL govType tag sets, so we never pair
// (say) a religious subject with a commercial predicate unless some actual polity carries both.

const ELEVATIONS: ElevationFamily[] = ["LOW", "MEDIUM", "HIGH", "VERY_HIGH"];
const BANDS: MoistureBand[] = ["DRY", "MID", "WET"];
// One ice value inside each band the `when`s cut at (0.2 / 0.25 / 0.3 / 0.35), plus none and a tundra-forcing one.
const ICE_POINTS = [0, 0.22, 0.27, 0.32, 0.37, 0.6];
const TIERS: CityTier[] = ["small", "medium", "big"];
const GOV_TAG_SETS = GOV_TYPES.map((g) => g.tags);

/** Can a single real city satisfy every one of these conditions at once? Rejects mountains-and-coast,
 *  desert-and-tundra, capital-and-not, religious-and-secular-govtype, etc., so the audit never sees combos
 *  the `when` gates make unreachable in practice. */
function jointlySatisfiable(conds: CityCondition[]): boolean {
  // Single-valued booleans must agree across all conditions.
  for (const key of ["capital", "coastal", "nearWater"] as const) {
    let v: boolean | undefined;
    for (const c of conds) {
      if (c[key] === undefined) continue;
      if (v !== undefined && v !== c[key]) return false;
      v = c[key];
    }
  }
  // The sea is water, so a coastal city is always nearWater.
  if (conds.some((c) => c.coastal === true) && conds.some((c) => c.nearWater === false)) return false;

  // Tier sets must intersect.
  let tiers = TIERS;
  for (const c of conds) if (c.tiers) tiers = tiers.filter((t) => c.tiers!.includes(t));
  if (tiers.length === 0) return false;

  // Elevation interval must be non-empty.
  let lo = 0;
  let hi = Infinity;
  for (const c of conds) {
    if (c.minElevationMeters !== undefined) lo = Math.max(lo, c.minElevationMeters);
    if (c.maxElevationMeters !== undefined) hi = Math.min(hi, c.maxElevationMeters);
  }
  if (lo > hi) return false;

  // Terrain: some (family, band, ice) — and thus biome — satisfies every terrain/ice constraint.
  const terrainOk = ELEVATIONS.some((elevation) =>
    BANDS.some((band) =>
      ICE_POINTS.some((ice) => {
        const biome = biomeName(elevation, band, ice);
        return conds.every(
          (c) =>
            (!c.elevations || c.elevations.includes(elevation)) &&
            (!c.bands || c.bands.includes(band)) &&
            (!c.biomes || c.biomes.includes(biome)) &&
            (c.minIce === undefined || ice >= c.minIce) &&
            (c.maxIce === undefined || ice <= c.maxIce),
        );
      }),
    ),
  );
  if (!terrainOk) return false;

  // Tags: some real government's tag set satisfies every condition's tag clauses.
  return GOV_TAG_SETS.some((tags) => conds.every((c) => tagsMatch(tags, c)));
}

const whenOf = (part: { when?: CityCondition }): CityCondition[] => (part.when ? [part.when] : []);

const addPair = (map: Map<string, Set<string>>, key: string, val: string): void => {
  (map.get(key) ?? map.set(key, new Set()).get(key)!).add(val);
};

export type AuditResult = {
  facts: Set<string>; // every reachable fun fact, fully rendered
  subjectsByPredicate: Map<string, Set<string>>; // raw predicate text → the subjects it can follow
  qualifiersByPredicate: Map<string, Set<string>>; // raw predicate text → the qualifiers that can trail it
};

/** Enumerate every reachable fun fact (full Cartesian per pattern, pruned to jointly-satisfiable slot
 *  combinations and the same cityWide / qualifier filters generation uses). Facts are rendered for reading;
 *  the per-predicate pair maps are the raw-text view that makes semantic mismatches easy to scan. */
export function enumerateReachableFunFacts(country = "Aldoria"): AuditResult {
  const ctx = { countryName: country } as CityContext;

  const facts = new Set<string>();
  const subjectsByPredicate = new Map<string, Set<string>>();
  const qualifiersByPredicate = new Map<string, Set<string>>();

  for (const pattern of FUN_FACT_PATTERNS) {
    const patternWhens = whenOf(pattern);
    if (!jointlySatisfiable(patternWhens)) continue;

    const slots = Object.entries(pattern.slots);

    const recurse = (i: number, chosen: Record<string, FactPart>, whens: CityCondition[]): void => {
      if (i === slots.length) {
        const number = chosen.subject?.number ?? GrammaticalNumber.Singular;
        const resolved: Record<string, string> = {};
        for (const [name, part] of Object.entries(chosen)) {
          resolved[name] = renderTemplate(inflect(part.text, number), resolved, ctx);
        }
        facts.add(renderTemplate(inflect(pattern.template, number), resolved, ctx));
        if (chosen.subject && chosen.predicate) addPair(subjectsByPredicate, chosen.predicate.text, chosen.subject.text);
        if (chosen.predicate && chosen.qualifier) addPair(qualifiersByPredicate, chosen.predicate.text, chosen.qualifier.text);
        return;
      }
      const [name, options] = slots[i];
      for (const opt of options) {
        if (name === "predicate" && opt.cityWide && !chosen.subject?.cityWide) continue;
        if (name === "predicate" && !acceptsSubject(opt, chosen.subject)) continue;
        if (name === "qualifier" && !acceptsQualifier(chosen.predicate, opt)) continue;
        const next = [...whens, ...whenOf(opt)];
        if (!jointlySatisfiable(next)) continue;
        chosen[name] = opt;
        recurse(i + 1, chosen, next);
        delete chosen[name];
      }
    };

    recurse(0, {}, patternWhens);
  }

  return { facts, subjectsByPredicate, qualifiersByPredicate };
}

const groupBlock = (title: string, map: Map<string, Set<string>>): string => {
  const lines = [`=== ${title} (${map.size} predicates) ===`];
  for (const key of [...map.keys()].sort()) {
    lines.push(`\n${key}`);
    for (const v of [...map.get(key)!].sort()) lines.push(`    ${v}`);
  }
  return lines.join("\n");
};

/** A plain-text dump for eyeballing: every reachable fact, then the adjacent-slot pairings grouped by
 *  predicate (the view where semantic mismatches stand out). Pure (no fs) so it survives `tsc`; print it
 *  with `console.log` from a throwaway test and redirect to a file. See docs/funfact-audit.md. */
export function formatAuditReport(country = "Aldoria"): string {
  const { facts, subjectsByPredicate, qualifiersByPredicate } = enumerateReachableFunFacts(country);
  return [
    `reachable facts: ${facts.size}`,
    "",
    "=== ALL FACTS (sorted) ===",
    [...facts].sort().join("\n"),
    "",
    groupBlock("SUBJECT per PREDICATE", subjectsByPredicate),
    "",
    groupBlock("QUALIFIER per PREDICATE", qualifiersByPredicate),
    "",
  ].join("\n");
}
