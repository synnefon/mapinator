import { describe, expect, it } from "vitest";
import { enumerateReachableFunFacts } from "./funFactAudit";
import { INDUSTRY_FLAVOR } from "./funFact";
import { INDUSTRY_NAMES } from "./industries";

// Enumerates EVERY reachable fun fact (see funFactAudit.ts) and guards the audited nonsense classes so
// they can't creep back: leaked tokens, climate statives taking a trailing clause, and city-wide
// predicates (guard-the-pass / hum-with-looms) attaching to a lone feature instead of "the town".
describe("fun-fact combo audit", () => {
  const { facts } = enumerateReachableFunFacts("Aldoria");
  const all = [...facts];

  it("reaches a large set of combos", () => {
    expect(all.length).toBeGreaterThan(2000);
  });

  it("never leaks a template token", () => {
    expect(all.filter((f) => /[{}]/.test(f))).toEqual([]);
  });

  it("keeps self-contained climate statives free of a trailing qualifier", () => {
    const trailing = all.filter((f) =>
      /(freezing for half the year|colder than the maps admit|cooler than the lowlands all summer) \S/.test(f),
    );
    expect(trailing).toEqual([]);
  });

  it("scopes settlement-wide predicates to a city-wide subject, never a feature", () => {
    const misattached = all.filter((f) => /\bits .*\b(guards? the only pass|hums? with looms)/.test(f));
    expect(misattached).toEqual([]);
  });

  it("trails the insider-access clause only on access predicates, never public/observable ones", () => {
    const access = all.filter((f) => f.includes("if you know who to ask"));
    expect(access.length).toBeGreaterThan(0); // still reaches the access predicates (keeps odd hours / trades …)
    // "if you know who to ask" is insider access; it must never follow a publicly-observable predicate
    // ("draws crowds … if you know who to ask", "impossible to find lodging in if you know who to ask").
    const onPublicPredicate = access.filter((f) => !/(odd hours|apologiz)/.test(f));
    expect(onPublicPredicate).toEqual([]);
  });

  // Subject-kind axis (SubjectKind / attachTo): a predicate implying bustle, commerce, or record-keeping must
  // not land on an inert monument, nor an economy/records claim on the wrong kind of feature.
  const MONUMENTS = /^its (bell tower|clock tower|walls|lighthouse|dawn bells|hill forts) /;

  it("keeps bustle/commerce/record predicates off inert monuments", () => {
    const activeVerbs =
      /(anchors? the local economy|keeps? the city richer|supports? much of the surrounding|trades? in everything|is busier than|draws? crowds|fills? up with strangers|keeps? better records|keeps? odd hours)/;
    const bad = all.filter((f) => MONUMENTS.test(f) && activeVerbs.test(f));
    expect(bad).toEqual([]);
    // monuments are still reachable — as sights and via stative/atmospheric predicates.
    expect(all.some((f) => MONUMENTS.test(f))).toBe(true);
  });

  it("scopes the economy predicates to market/industry subjects only", () => {
    const NON_ECONOMIC =
      /^its (mountain roads|steep streets|temples|pilgrim roads|libraries|academies|public lectures|barracks|parade grounds|courts|ministry halls|noble houses|central square|oldest tavern|narrow streets|assembly hall|governor's palace|bathhouses|riverfront|festival grounds|back alleys|garden terraces) /;
    const economy = /(anchors? the local economy|keeps? the city richer than it looks|supports? much of the surrounding countryside)/;
    expect(all.filter((f) => NON_ECONOMIC.test(f) && economy.test(f))).toEqual([]);
    // coverage: the economy predicates still reach both market and industry subjects.
    expect(all.some((f) => /^its (docks|counting houses|toll bridge) /.test(f) && economy.test(f))).toBe(true);
    expect(all.some((f) => /^its (mines|granaries|orchards) /.test(f) && economy.test(f))).toBe(true);
  });

  it("keeps the gathering predicates (draw crowds / fill up) off production-only industry subjects", () => {
    // The works→market/industry split: a foundry or mine is busy but isn't a destination people flock to.
    const INDUSTRY =
      /^its (shipyards|orchards|vineyards|mines|quarries|foundries|workshops|terraced fields|granaries|riverside mills|glassworks) /;
    const gathering = /(draws? crowds from every village|fills? up with strangers)/;
    expect(all.filter((f) => INDUSTRY.test(f) && gathering.test(f))).toEqual([]);
    // markets still gather, and industry is still reachable (busy / anchors the economy) — neither was stranded.
    expect(all.some((f) => /^its (docks|fish markets|night market|caravanserai) /.test(f) && gathering.test(f))).toBe(true);
    expect(all.some((f) => INDUSTRY.test(f) && /(is|are) busier than its size/.test(f))).toBe(true);
  });

  it("scopes the records predicate to institution subjects only", () => {
    const records = /keeps? better records than the capital/;
    const onInstitution = all.filter((f) => records.test(f));
    expect(onInstitution.length).toBeGreaterThan(0); // still reaches courts/ministry halls/libraries/…
    const notInstitution =
      /^its (harbor|docks|shipyards|fish markets|grain markets|orchards|vineyards|mines|quarries|mountain roads|steep streets|pilgrim roads|dawn bells|walls|parade grounds|noble houses|old market|central square|oldest tavern|narrow streets|foundries|workshops|caravanserai|terraced fields|toll bridge|bell tower|bathhouses|riverfront|granaries|counting houses|winter markets|festival grounds|back alleys|night market|lighthouse|clock tower|wool markets|riverside mills|hill forts|garden terraces|glassworks) /;
    expect(onInstitution.filter((f) => notInstitution.test(f))).toEqual([]);
  });

  // Industry flavour (INDUSTRY_FLAVOR → industryPatterns) must cover every industry, so a city's flavour
  // line can always match its actual trades rather than the government's Society.Industrial tag.
  it("has at least one industry-flavour template for every industry", () => {
    const missing = INDUSTRY_NAMES.filter((n) => !(INDUSTRY_FLAVOR[n]?.length >= 1));
    expect(missing).toEqual([]);
  });
});
