import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import {
  applySettlementNoun,
  finishSettlements,
  habitabilityWeight,
  HABITABILITY_FLOOR,
  minLevelForPopulation,
  type PlacedCandidate,
  scanScale,
  settlementClass,
  type SettlementWorld,
  topByPopulation,
} from "./settlements";

// ===================== The one settlement engine =====================
// scanScale is pure: all field + water access is through an injected SettlementWorld. A fake world (uniform
// habitable land, one country, no water) exercises the grid / size / scale machinery without a real map — the
// same engine the head (coarse scales over the whole sphere) and the tail (fine scales over a cap) both run.
// Size = density × the scale's cell area × urbanFraction; how many render is the caller's topByPopulation cut.

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
  urbanFraction: 0.4,
  planetRadiusKm: R,
  seed: "probe",
};
const scan = (worldOver: Partial<SettlementWorld> = {}, argsOver: Partial<typeof base> = {}): PlacedCandidate[] =>
  scanScale({ ...base, ...argsOver, world: fakeWorld(worldOver) });
const maxPop = (cands: PlacedCandidate[]): number => Math.max(...cands.map((c) => c.population));
const posKey = (c: PlacedCandidate): string => `${c.pos.x.toFixed(6)},${c.pos.y.toFixed(6)},${c.pos.z.toFixed(6)}`;

describe("scanScale (the density-driven settlement field)", () => {
  it("is location-deterministic — same args yield the identical field (no flicker on re-query)", () => {
    expect(scan()).toStrictEqual(scan());
  });

  it("keeps the same candidates in place when the cap shrinks (a settlement is a property of its spot)", () => {
    const wide = scan({}, { capAngle: 0.1 });
    const narrow = scan({}, { capAngle: 0.05 }); // a sub-region of the same field
    const wideKeys = new Set(wide.map(posKey));
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.length).toBeLessThan(wide.length);
    for (const t of narrow) expect(wideKeys.has(posKey(t))).toBe(true); // narrow ⊂ wide, in place
  });

  it("keeps the same candidates in place when the view PANS — including across the ±π seam (no reshuffle)", () => {
    const onEquator = (lon: number): Vec3 => ({ x: Math.cos(lon), y: 0, z: Math.sin(lon) });
    const k = (t: PlacedCandidate) => `${t.pos.x.toFixed(7)},${t.pos.y.toFixed(7)},${t.pos.z.toFixed(7)}`;
    const stableAcross = (lonA: number, lonB: number): void => {
      const a = onEquator(lonA);
      const b = onEquator(lonB);
      const cos = Math.cos(base.capAngle);
      const inBoth = (towns: PlacedCandidate[], other: Vec3) => towns.filter((t) => Vec3.dot(t.pos, other) >= cos);
      const fromA = new Set(inBoth(scan({}, { center: a }), b).map(k));
      const fromB = new Set(inBoth(scan({}, { center: b }), a).map(k));
      expect(fromA.size).toBeGreaterThan(0);
      expect([...fromA]).toStrictEqual([...fromB].filter((key) => fromA.has(key))); // overlap identical both ways
      for (const key of fromB) expect(fromA.has(key)).toBe(true);
    };
    stableAcross(0.2, 0.23); // interior pan
    stableAcross(Math.PI - 0.03, Math.PI + 0.05); // pan across ±π (the seam)
  });

  it("places every candidate inside the cap", () => {
    const cos = Math.cos(base.capAngle);
    for (const t of scan()) expect(Vec3.dot(t.pos, base.center)).toBeGreaterThanOrEqual(cos - 1e-9);
  });

  it("sizes each settlement by local carrying capacity — density × catchment × urbanFraction", () => {
    // Doubling urbanFraction doubles every settlement's population at the same spot (nothing else changed).
    const a = scan({}, { urbanFraction: 0.4 });
    const b = scan({}, { urbanFraction: 0.8 });
    expect(a.length).toBeGreaterThan(0);
    const bByPos = new Map(b.map((c) => [posKey(c), c.population]));
    for (const c of a) expect(bByPos.get(posKey(c))! / c.population).toBeCloseTo(2, 1);
  });

  it("makes a coarser scale grow proportionally bigger settlements (fixed catchment ladder)", () => {
    // Catchment ∝ gridAngle², so doubling the spacing ~quadruples the size — the source of the size range.
    const ratio = maxPop(scan({}, { gridAngle: 0.006 })) / maxPop(scan({}, { gridAngle: 0.003 }));
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });

  it("never places a settlement on water / unclaimed (countryAt < 0) or uninhabitable (density 0) land", () => {
    const claimed = scan({ countryAt: (p) => (p.y > 0 ? 0 : -1) }, { capAngle: 0.3 });
    expect(claimed.length).toBeGreaterThan(0);
    for (const t of claimed) expect(t.pos.y).toBeGreaterThan(0);
    const habitable = scan({ popDensityAt: (p) => (p.y > 0 ? 30 : 0) }, { capAngle: 0.3 });
    expect(habitable.length).toBeGreaterThan(0);
    for (const t of habitable) expect(t.pos.y).toBeGreaterThan(0);
  });
});

describe("topByPopulation (the render-count floor)", () => {
  it("keeps exactly the n largest by population", () => {
    const cands = scan({ popDensityAt: (p) => (p.y > 0 ? 40 : 4) }, { capAngle: 0.3 });
    const n = Math.floor(cands.length / 4);
    const top = topByPopulation(cands, n);
    expect(top.length).toBe(n);
    const kept = new Set(top);
    const keptMin = Math.min(...top.map((t) => t.population));
    for (const c of cands) if (!kept.has(c)) expect(c.population).toBeLessThanOrEqual(keptMin);
  });

  it("concentrates the rendered settlements where density is higher (clustering via size, not count)", () => {
    // Every land cell is a candidate; density drives SIZE, so the top-N renders densely-peopled ground.
    const cands = scan({ popDensityAt: (p) => (p.y > 0 ? 40 : 4) }, { capAngle: 0.3 });
    const top = topByPopulation(cands, Math.floor(cands.length / 3));
    const north = top.filter((t) => t.pos.y > 0).length;
    const south = top.filter((t) => t.pos.y < 0).length;
    expect(north).toBeGreaterThan(south * 3);
  });

  it("returns a copy of everything when n exceeds the count", () => {
    const cands = scan();
    const all = topByPopulation(cands, cands.length + 10);
    expect(all.length).toBe(cands.length);
    expect(all).not.toBe(cands); // a copy — never the caller's array
  });
});

describe("finishSettlements (route + terrain read for the survivors)", () => {
  it("routes every kept candidate through world.routeAt (carries water kind, snapped anchor, fields, population)", () => {
    const shift = (p: Vec3): Vec3 => Vec3.normalize({ x: p.x, y: p.y + 0.01, z: p.z });
    const world = fakeWorld({ routeAt: (p) => ({ anchor: shift(p), waterKind: "river" }) });
    const cands = scanScale({ ...base, world });
    const sites = finishSettlements(cands, world);
    expect(sites.length).toBe(cands.length);
    for (let i = 0; i < sites.length; i++) {
      expect(sites[i].waterKind).toBe("river"); // the route's classification rides through
      expect(sites[i].population).toBe(cands[i].population);
      expect(sites[i].countryIndex).toBe(cands[i].countryIndex);
      expect(sites[i].coastDist).toBe(5); // terrain read from world.fieldAt
    }
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
