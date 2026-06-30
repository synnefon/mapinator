import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import { growRegionTowns, type RegionTown } from "./regionTowns";

const R = 6371;
const base = {
  center: { x: 1, y: 0, z: 0 } as Vec3, // on the equator
  capAngle: 0.1,
  gridAngle: 0.003,
  minPop: 100,
  ceilingPop: 8000,
  perCapita: 17_000,
  planetRadiusKm: R,
  popDensityAt: (_p: Vec3) => 30, // uniform, habitable
  countryAt: (_p: Vec3) => 0, // all land, one country
  seed: "probe",
};

const run = (over: Partial<typeof base> = {}): RegionTown[] => growRegionTowns({ ...base, ...over });

describe("growRegionTowns", () => {
  it("is location-deterministic — same args yield the identical field (no flicker on re-query)", () => {
    expect(run()).toStrictEqual(run());
  });

  it("keeps the same towns in place when the cap shrinks (a town is a property of its spot, not the query)", () => {
    const wide = run({ capAngle: 0.1 });
    const narrow = run({ capAngle: 0.05 }); // a sub-region of the same field
    const key = (t: RegionTown) => `${t.anchor.x.toFixed(6)},${t.anchor.y.toFixed(6)},${t.anchor.z.toFixed(6)}`;
    const wideKeys = new Set(wide.map(key));
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.length).toBeLessThan(wide.length);
    for (const t of narrow) expect(wideKeys.has(key(t))).toBe(true); // narrow ⊂ wide, in place
  });

  it("keeps the same towns in place when the view PANS — including across the ±π seam (no reshuffle)", () => {
    // The grid is global, so a town in the overlap of two caps must land at the IDENTICAL spot no matter
    // where the cap is centred. The hard case is the antimeridian: atan2 jumps +π↔-π, so a naive oi grid
    // picks a different cell on each side and the whole strip reshuffles as you orbit across it.
    const onEquator = (lon: number): Vec3 => ({ x: Math.cos(lon), y: 0, z: Math.sin(lon) });
    const k = (t: RegionTown) => `${t.anchor.x.toFixed(7)},${t.anchor.y.toFixed(7)},${t.anchor.z.toFixed(7)}`;
    const stableAcross = (lonA: number, lonB: number): void => {
      const a = onEquator(lonA);
      const b = onEquator(lonB);
      const cos = Math.cos(base.capAngle);
      const inBoth = (towns: RegionTown[], other: Vec3) => towns.filter((t) => Vec3.dot(t.anchor, other) >= cos);
      const fromA = new Set(inBoth(run({ center: a }), b).map(k));
      const fromB = new Set(inBoth(run({ center: b }), a).map(k));
      expect(fromA.size).toBeGreaterThan(0);
      expect([...fromA]).toStrictEqual([...fromB].filter((key) => fromA.has(key))); // overlap identical both ways
      for (const key of fromB) expect(fromA.has(key)).toBe(true);
    };
    stableAcross(0.2, 0.23); // interior pan
    stableAcross(Math.PI - 0.03, Math.PI + 0.05); // pan across ±π (the seam)
  });

  it("places every town inside the cap", () => {
    const cos = Math.cos(base.capAngle);
    for (const t of run()) expect(Vec3.dot(t.anchor, base.center)).toBeGreaterThanOrEqual(cos - 1e-9);
  });

  it("respects the size window [minPop, ceilingPop)", () => {
    for (const t of run()) {
      expect(t.population).toBeGreaterThanOrEqual(base.minPop);
      expect(t.population).toBeLessThan(base.ceilingPop);
    }
  });

  it("treats minPop as the zoom LOD — a higher floor reveals strictly fewer (bigger) towns", () => {
    const all = run({ minPop: 100 });
    const big = run({ minPop: 2_000 });
    expect(big.length).toBeLessThan(all.length);
    for (const t of big) expect(t.population).toBeGreaterThanOrEqual(2_000);
  });

  it("clusters towns where population density is higher (the 1400 'towns where people are')", () => {
    // Dense north, sparse south; count each side of the equator over a cap that straddles it.
    const towns = run({ capAngle: 0.3, popDensityAt: (p) => (p.y > 0 ? 40 : 4) });
    const north = towns.filter((t) => t.anchor.y > 0).length;
    const south = towns.filter((t) => t.anchor.y < 0).length;
    expect(north).toBeGreaterThan(south * 3); // ~10× the density ⇒ many more towns
  });

  it("draws a village-dominated body with a thin town/city tail (lognormal + Pareto)", () => {
    const towns = run({ capAngle: 0.3, minPop: 30 }); // include the whole body down to hamlets
    expect(towns.length).toBeGreaterThan(50);
    const pops = towns.map((t) => t.population).sort((a, b) => a - b);
    const median = pops[Math.floor(pops.length / 2)];
    expect(median).toBeLessThan(1500); // the bulk are villages (the lognormal body), not towns
    expect(towns.some((t) => t.population >= 2000)).toBe(true); // but a Pareto tail of towns/cities exists
  });

  it("never places a town on water / unclaimed land (countryAt < 0)", () => {
    const towns = run({ capAngle: 0.3, countryAt: (p) => (p.y > 0 ? 0 : -1) });
    expect(towns.length).toBeGreaterThan(0);
    for (const t of towns) expect(t.anchor.y).toBeGreaterThan(0);
  });
});
