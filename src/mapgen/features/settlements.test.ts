import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import {
  applySettlementNoun,
  finishSettlements,
  habitabilityWeight,
  HABITABILITY_FLOOR,
  minLevelForPopulation,
  type PlacedCandidate,
  placeSettlements,
  type RankSizeDials,
  rankSizePopulations,
  settlementClass,
  type SettlementWorld,
} from "./settlements";

// ===================== The one continuous settlement law =====================
// rankSizePopulations + placeSettlements are pure. The rank-size law turns a country's population into a
// descending size curve; placeSettlements ranks the country's cells by an injected SettlementWorld's density
// (all placement bias) and drops the sizes onto the best, well-spaced spots. Fakes exercise both with no map.

const dials = (over: Partial<RankSizeDials> = {}): RankSizeDials => ({
  largestCityShare: 0.1,
  rankFalloff: 1,
  minCityPop: 1000,
  maxCities: 1000,
  ...over,
});

describe("rankSizePopulations (the continuous rank-size law)", () => {
  it("emits sizes largest-first, size(rank) = share·P / rank^α", () => {
    const sizes = rankSizePopulations(1_000_000, dials()); // size1 = 100k, α = 1, floor 1k → 100 ranks
    expect(sizes[0]).toBeCloseTo(100_000, 5);
    expect(sizes[1]).toBeCloseTo(50_000, 5);
    expect(sizes[2]).toBeCloseTo(100_000 / 3, 5);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]); // strictly descending
  });

  it("stops at the floor — every emitted size is ≥ MIN_CITY_POP", () => {
    const sizes = rankSizePopulations(1_000_000, dials({ minCityPop: 1000 }));
    expect(sizes[sizes.length - 1]).toBeGreaterThanOrEqual(1000);
    expect(100_000 / (sizes.length + 1)).toBeLessThan(1000); // the NEXT rank would fall below the floor
  });

  it("responds continuously to population — a bigger country GROWS every size AND gains more ranks", () => {
    const small = rankSizePopulations(1_000_000, dials());
    const big = rankSizePopulations(4_000_000, dials());
    expect(big[0]).toBeGreaterThan(small[0]); // the capital grows
    expect(big.length).toBeGreaterThan(small.length); // and new small settlements appear at the bottom
    expect(big[0] / small[0]).toBeCloseTo(4, 1); // size1 ∝ P
  });

  it("always keeps at least the capital, even for a near-empty country", () => {
    const sizes = rankSizePopulations(100, dials({ minCityPop: 1000 })); // size1 = 10 < floor
    expect(sizes.length).toBe(1);
    expect(sizes[0]).toBeGreaterThan(0);
  });

  it("obeys the MAX_CITIES safety cap", () => {
    expect(rankSizePopulations(1e9, dials({ maxCities: 5 })).length).toBe(5);
  });

  it("a steeper falloff (α) yields fewer, more top-heavy settlements", () => {
    const flat = rankSizePopulations(5_000_000, dials({ rankFalloff: 1 }));
    const steep = rankSizePopulations(5_000_000, dials({ rankFalloff: 1.5 }));
    expect(steep.length).toBeLessThan(flat.length); // fewer clear the floor
    expect(steep[0]).toBeCloseTo(flat[0], 5); // same capital (rank 1 is share·P either way)
    expect(steep[1]).toBeLessThan(flat[1]); // but the 2nd city drops off faster
  });
});

// A row of `n` cells along the equator around (1,0,0), one base cell-spacing apart, indexed 0…n-1.
const cellSpacingRad = 0.02;
const cellRow = (n: number): Vec3[] => {
  const s: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const lon = (i - (n - 1) / 2) * cellSpacingRad;
    s.push({ x: Math.cos(lon), y: 0, z: Math.sin(lon) });
  }
  return s;
};
const fakeWorld = (over: Partial<SettlementWorld> = {}): SettlementWorld => ({
  popDensityAt: () => 30, // uniform, habitable
  countryAt: () => 0,
  routeAt: (p) => ({ anchor: p, waterKind: "none" }),
  fieldAt: () => ({ cell: 0, rawElevation: 0.5, reportElevation: 0.5, moisture: 0.5, ice: 0, coastDist: 5, seaDist: 5 }),
  ...over,
});
const place = (args: {
  sites: Vec3[];
  world?: Partial<SettlementWorld>;
  populations: number[];
  spacingCells?: number;
  spread?: number;
  sizeJitter?: number;
}): PlacedCandidate[] =>
  placeSettlements({
    cells: args.sites.map((_s, i) => i),
    siteOf: (c) => args.sites[c],
    world: fakeWorld(args.world),
    countryIndex: 0,
    populations: args.populations,
    spacingCells: args.spacingCells ?? 1,
    spread: args.spread ?? 0,
    sizeJitter: args.sizeJitter ?? 0,
    cellSpacingRad,
    seed: "probe",
  });

describe("placeSettlements (biggest cities on the best, well-spaced land)", () => {
  it("is deterministic — same args yield the identical placement", () => {
    const sites = cellRow(40);
    const pops = rankSizePopulations(1_000_000, dials());
    expect(place({ sites, populations: pops })).toStrictEqual(place({ sites, populations: pops }));
  });

  it("returns candidates largest-first — out[0] is the capital (the biggest)", () => {
    const out = place({ sites: cellRow(40), populations: rankSizePopulations(1_000_000, dials()), sizeJitter: 0.15 });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.population).toBeLessThanOrEqual(out[0].population);
  });

  it("puts the biggest city on the densest cell (placement keeps the habitability ranking)", () => {
    const sites = cellRow(40);
    const peakIdx = 27;
    // A single dense peak; the capital must land ON it (within the sub-cell position jitter).
    const out = place({ sites, world: { popDensityAt: (p) => (Math.abs(p.z - sites[peakIdx].z) < 1e-6 ? 500 : 10) }, populations: rankSizePopulations(1_000_000, dials()) });
    expect(Math.abs(out[0].pos.z - sites[peakIdx].z)).toBeLessThan(cellSpacingRad);
  });

  it("never places on uninhabitable (density 0) cells", () => {
    const sites = cellRow(40);
    const out = place({ sites, world: { popDensityAt: (p) => (p.z > 0 ? 30 : 0) }, populations: rankSizePopulations(2_000_000, dials()) });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.pos.z).toBeGreaterThan(0);
  });

  it("spaces settlements out — a bigger footprint (SPACING) places fewer of them", () => {
    const sites = cellRow(60);
    const pops = rankSizePopulations(3_000_000, dials());
    const tight = place({ sites, populations: pops, spacingCells: 1 });
    const spread = place({ sites, populations: pops, spacingCells: 6 });
    expect(spread.length).toBeLessThan(tight.length); // a larger reserved footprint fits fewer
  });

  it("guarantees the capital even when a single cell can't fit the whole curve", () => {
    const out = place({ sites: cellRow(1), populations: rankSizePopulations(1_000_000, dials()), spacingCells: 6 });
    expect(out.length).toBe(1);
    expect(out[0].population).toBeGreaterThan(0);
  });

  it("gives a fully-uninhabitable country its capital anyway (least-bad cell)", () => {
    const out = place({ sites: cellRow(20), world: { popDensityAt: () => 0 }, populations: rankSizePopulations(500_000, dials()) });
    expect(out.length).toBe(1); // one capital, so the country isn't blank
  });
});

describe("finishSettlements (route + terrain read for placed candidates)", () => {
  it("routes every candidate through world.routeAt (carries water kind, snapped anchor, fields, population)", () => {
    const shift = (p: Vec3): Vec3 => Vec3.normalize({ x: p.x, y: p.y + 0.01, z: p.z });
    const world = fakeWorld({ routeAt: (p) => ({ anchor: shift(p), waterKind: "river" }) });
    const cands = place({ sites: cellRow(30), populations: rankSizePopulations(1_000_000, dials()) });
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
