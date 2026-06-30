import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import {
  applySettlementNoun,
  growSettlements,
  habitabilityWeight,
  HABITABILITY_FLOOR,
  minLevelForPopulation,
  type PlacedSite,
  settlementClass,
  type SettlementWorld,
} from "./settlements";

// ===================== The one settlement engine =====================
// growSettlements is pure: all field + water access is through an injected SettlementWorld. A fake world
// (uniform habitable land, one country, no water) exercises the grid / window / accept / route machinery
// without a real map — the same engine the head (whole sphere) and the tail (a view cap) both run.

const R = 6371;
const fakeWorld = (over: Partial<SettlementWorld> = {}): SettlementWorld => ({
  popDensityAt: () => 30, // uniform, habitable
  countryAt: () => 0, // all land, one country
  routeAt: (p) => ({ anchor: p, waterKind: "none" }), // no water → keep the jittered point
  fieldAt: () => ({ cell: 0, rawElevation: 0.5, reportElevation: 0.5, moisture: 0.5, ice: 0, coastDist: 5, seaDist: 5 }),
  ...over,
});

const base = {
  center: { x: 1, y: 0, z: 0 } as Vec3, // on the equator
  capAngle: 0.1,
  gridAngle: 0.003,
  minPop: 100,
  ceilingPop: 8000,
  perCapita: 17_000,
  planetRadiusKm: R,
  seed: "probe",
};
const run = (worldOver: Partial<SettlementWorld> = {}, argsOver: Partial<typeof base> = {}): PlacedSite[] =>
  growSettlements({ ...base, ...argsOver, world: fakeWorld(worldOver) });

describe("growSettlements", () => {
  it("is location-deterministic — same args yield the identical field (no flicker on re-query)", () => {
    expect(run()).toStrictEqual(run());
  });

  it("keeps the same settlements in place when the cap shrinks (a settlement is a property of its spot)", () => {
    const wide = run({}, { capAngle: 0.1 });
    const narrow = run({}, { capAngle: 0.05 }); // a sub-region of the same field
    const key = (t: PlacedSite) => `${t.anchor.x.toFixed(6)},${t.anchor.y.toFixed(6)},${t.anchor.z.toFixed(6)}`;
    const wideKeys = new Set(wide.map(key));
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.length).toBeLessThan(wide.length);
    for (const t of narrow) expect(wideKeys.has(key(t))).toBe(true); // narrow ⊂ wide, in place
  });

  it("keeps the same settlements in place when the view PANS — including across the ±π seam (no reshuffle)", () => {
    const onEquator = (lon: number): Vec3 => ({ x: Math.cos(lon), y: 0, z: Math.sin(lon) });
    const k = (t: PlacedSite) => `${t.anchor.x.toFixed(7)},${t.anchor.y.toFixed(7)},${t.anchor.z.toFixed(7)}`;
    const stableAcross = (lonA: number, lonB: number): void => {
      const a = onEquator(lonA);
      const b = onEquator(lonB);
      const cos = Math.cos(base.capAngle);
      const inBoth = (towns: PlacedSite[], other: Vec3) => towns.filter((t) => Vec3.dot(t.anchor, other) >= cos);
      const fromA = new Set(inBoth(run({}, { center: a }), b).map(k));
      const fromB = new Set(inBoth(run({}, { center: b }), a).map(k));
      expect(fromA.size).toBeGreaterThan(0);
      expect([...fromA]).toStrictEqual([...fromB].filter((key) => fromA.has(key))); // overlap identical both ways
      for (const key of fromB) expect(fromA.has(key)).toBe(true);
    };
    stableAcross(0.2, 0.23); // interior pan
    stableAcross(Math.PI - 0.03, Math.PI + 0.05); // pan across ±π (the seam)
  });

  it("places every settlement inside the cap", () => {
    const cos = Math.cos(base.capAngle);
    for (const t of run()) expect(Vec3.dot(t.anchor, base.center)).toBeGreaterThanOrEqual(cos - 1e-9);
  });

  it("respects the size window [minPop, ceilingPop)", () => {
    for (const t of run()) {
      expect(t.population).toBeGreaterThanOrEqual(base.minPop);
      expect(t.population).toBeLessThan(base.ceilingPop);
    }
  });

  it("treats minPop as the zoom LOD — a higher floor reveals strictly fewer (bigger) settlements", () => {
    const all = run({}, { minPop: 100 });
    const big = run({}, { minPop: 2_000 });
    expect(big.length).toBeLessThan(all.length);
    for (const t of big) expect(t.population).toBeGreaterThanOrEqual(2_000);
  });

  it("clusters where population density is higher (the 1400 'settlements where people are')", () => {
    // Dense north, sparse south; count each side of the equator over a cap that straddles it.
    const towns = run({ popDensityAt: (p) => (p.y > 0 ? 40 : 4) }, { capAngle: 0.3 });
    const north = towns.filter((t) => t.anchor.y > 0).length;
    const south = towns.filter((t) => t.anchor.y < 0).length;
    expect(north).toBeGreaterThan(south * 3); // ~10× the density ⇒ many more settlements
  });

  it("draws a village-dominated body with a thin town/city tail (lognormal + Pareto)", () => {
    const towns = run({}, { capAngle: 0.3, minPop: 30 }); // include the whole body down to hamlets
    expect(towns.length).toBeGreaterThan(50);
    const pops = towns.map((t) => t.population).sort((a, b) => a - b);
    const median = pops[Math.floor(pops.length / 2)];
    expect(median).toBeLessThan(1500); // the bulk are villages (the lognormal body), not towns
    expect(towns.some((t) => t.population >= 2000)).toBe(true); // but a Pareto tail of towns/cities exists
  });

  it("never places a settlement on water / unclaimed land (countryAt < 0)", () => {
    const towns = run({ countryAt: (p) => (p.y > 0 ? 0 : -1) }, { capAngle: 0.3 });
    expect(towns.length).toBeGreaterThan(0);
    for (const t of towns) expect(t.anchor.y).toBeGreaterThan(0);
  });

  it("routes every accepted settlement through world.routeAt (carries its water kind + snapped anchor)", () => {
    const shift = (p: Vec3): Vec3 => Vec3.normalize({ x: p.x, y: p.y + 0.01, z: p.z });
    const towns = run({ routeAt: (p) => ({ anchor: shift(p), waterKind: "river" }) });
    expect(towns.length).toBeGreaterThan(0);
    for (const t of towns) expect(t.waterKind).toBe("river"); // the route's classification rides through
  });
});

describe("habitabilityWeight (settlements avoid deserts + ice)", () => {
  it("leaves well-watered, ice-free land at full weight regardless of aversion", () => {
    expect(habitabilityWeight(0.9, 0, 0, 1, 1)).toBe(1);
  });

  it("penalises dry land far from water, scaled by desert aversion", () => {
    expect(habitabilityWeight(0.0, 0, 0, 0, 0)).toBe(1); // aversion 0 → no penalty even bone dry
    const mild = habitabilityWeight(0.0, 0, 0, 0.5, 0);
    const full = habitabilityWeight(0.0, 0, 0, 1, 0);
    expect(mild).toBeLessThan(1);
    expect(full).toBeLessThan(mild); // stronger aversion → harsher penalty
  });

  it("waives the dryness penalty near water — desert coasts, riverbanks + oases settle freely", () => {
    expect(habitabilityWeight(0.0, 0, 1, 1, 0)).toBe(1); // bone dry but ON water → no penalty
    const inland = habitabilityWeight(0.0, 0, 0, 1, 0);
    const halfway = habitabilityWeight(0.0, 0, 0.5, 1, 0);
    expect(halfway).toBeGreaterThan(inland); // nearer water ⇒ less penalised
  });

  it("penalises iced land everywhere (even on a coast), scaled by ice aversion", () => {
    expect(habitabilityWeight(0.9, 1, 0, 0, 0)).toBe(1); // ice aversion 0 → no penalty
    expect(habitabilityWeight(0.9, 1, 0, 0, 1)).toBeLessThan(1); // inland ice → penalised
    expect(habitabilityWeight(0.9, 1, 1, 0, 1)).toBeLessThan(1); // ON water → ice STILL penalises (unlike dryness)
  });

  it("never drops below the floor — the worst land is rare, not impossible", () => {
    const worst = habitabilityWeight(0.0, 1, 0, 1, 1); // bone dry, fully iced, far from water, max aversion
    expect(worst).toBeGreaterThanOrEqual(HABITABILITY_FLOOR);
    expect(worst).toBeGreaterThan(0); // a settlement here stays POSSIBLE
  });
});

describe("settlementClass", () => {
  it("maps population to the size noun at the documented thresholds", () => {
    expect(settlementClass(0)).toBe("hamlet");
    expect(settlementClass(99)).toBe("hamlet");
    expect(settlementClass(100)).toBe("village");
    expect(settlementClass(999)).toBe("village");
    expect(settlementClass(1_000)).toBe("town");
    expect(settlementClass(99_999)).toBe("town");
    expect(settlementClass(100_000)).toBe("city");
    expect(settlementClass(999_999)).toBe("city");
    expect(settlementClass(1_000_000)).toBe("metropolis");
  });
});

describe("applySettlementNoun", () => {
  it("rewrites a standalone town/city to the population noun", () => {
    expect(applySettlementNoun("the town keeps a holiday", 80)).toBe("the hamlet keeps a holiday");
    expect(applySettlementNoun("the city spreads where it cannot climb", 2_000_000)).toBe(
      "the metropolis spreads where it cannot climb"
    );
  });

  it("keeps the possessive 's", () => {
    expect(applySettlementNoun("the town's dead lie beyond the walls", 500)).toBe(
      "the village's dead lie beyond the walls"
    );
    expect(applySettlementNoun("half the city's letters pass through", 250_000)).toBe(
      "half the city's letters pass through"
    );
  });

  it("leaves plurals and closed compounds alone (they mean OTHER places / people)", () => {
    expect(applySettlementNoun("a dozen cities have tried to copy it", 80)).toBe("a dozen cities have tried to copy it");
    expect(applySettlementNoun("the townsfolk leave for the month", 80)).toBe("the townsfolk leave for the month");
    expect(applySettlementNoun("two towns share the same name", 80)).toBe("two towns share the same name");
  });

  it("rewrites every occurrence in a line consistently", () => {
    expect(applySettlementNoun("the town stands on both banks; each side is the real city", 300)).toBe(
      "the village stands on both banks; each side is the real village"
    );
  });
});

describe("minLevelForPopulation", () => {
  it("reveals bigger settlements at lower (earlier) zoom levels", () => {
    expect(minLevelForPopulation(80)).toBe(6);
    expect(minLevelForPopulation(1_000)).toBe(5);
    expect(minLevelForPopulation(3_000)).toBe(4);
    expect(minLevelForPopulation(10_000)).toBe(3);
    expect(minLevelForPopulation(30_000)).toBe(2);
    expect(minLevelForPopulation(200_000)).toBe(1);
  });

  it("is monotonic — a larger place never reveals later", () => {
    let prev = 7;
    for (const p of [50, 800, 2_000, 5_000, 16_000, 50_000, 1_000_000]) {
      const lvl = minLevelForPopulation(p);
      expect(lvl).toBeLessThanOrEqual(prev);
      prev = lvl;
    }
  });
});
