import { describe, expect, it } from "vitest";
import { applySettlementNoun, minLevelForPopulation, settlementClass } from "./settlement";

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
    // city → city is a no-op at this size, but the 's must survive the pass.
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
