import { describe, expect, it } from "vitest";
import {
  cellSuitability,
  coastBonus,
  meanAnnualTempC,
  moistureSuitability,
  ruggednessFactor,
  temperatureNiche,
} from "./suitability";

const SEA = 0.47; // the default waterline (OCEANS.SEA_LEVEL); tests pass it explicitly

describe("meanAnnualTempC", () => {
  it("is warmest at the equator and falls toward the poles", () => {
    expect(meanAnnualTempC(0, SEA, SEA)).toBeGreaterThan(meanAnnualTempC(45, SEA, SEA));
    expect(meanAnnualTempC(45, SEA, SEA)).toBeGreaterThan(meanAnnualTempC(80, SEA, SEA));
  });

  it("cools with elevation via the lapse rate", () => {
    const lowland = meanAnnualTempC(10, SEA, SEA);
    const highland = meanAnnualTempC(10, SEA + (1 - SEA) * 0.4, SEA); // ~3500 m up, same latitude
    expect(highland).toBeLessThan(lowland);
    expect(lowland - highland).toBeGreaterThan(10); // a few thousand metres = double-digit cooling
  });
});

describe("temperatureNiche", () => {
  it("peaks in the temperate band and collapses in the cold", () => {
    expect(temperatureNiche(13, 0.5)).toBeGreaterThan(temperatureNiche(-15, 0.5));
  });

  it("rewards hot land only when it is wet (monsoon), not when dry (desert)", () => {
    expect(temperatureNiche(27, 0.9)).toBeGreaterThan(temperatureNiche(27, 0.1));
  });
});

describe("moistureSuitability", () => {
  it("rises from desert toward well-watered land", () => {
    expect(moistureSuitability(0.7, 13)).toBeGreaterThan(moistureSuitability(0.1, 13));
  });

  it("keeps true desert non-zero (oasis trade) but small", () => {
    const desert = moistureSuitability(0.05, 22);
    expect(desert).toBeGreaterThan(0);
    expect(desert).toBeLessThan(0.2);
  });

  it("walks density back down in the hottest, wettest rainforest", () => {
    expect(moistureSuitability(0.95, 27)).toBeLessThan(moistureSuitability(0.7, 24));
  });
});

describe("ruggednessFactor", () => {
  it("is 1 on flat ground and drops as terrain steepens", () => {
    expect(ruggednessFactor(0)).toBe(1);
    expect(ruggednessFactor(0.1)).toBeLessThan(ruggednessFactor(0.01));
    expect(ruggednessFactor(0.1)).toBeGreaterThan(0);
  });
});

describe("coastBonus", () => {
  it("is strongest on the shore and fades to 1 far inland", () => {
    expect(coastBonus(0)).toBeGreaterThan(coastBonus(5));
    expect(coastBonus(1000)).toBeCloseTo(1, 5);
  });

  it("is neutral (1) where no water was reached", () => {
    expect(coastBonus(-1)).toBe(1);
  });
});

describe("cellSuitability", () => {
  const temperatePlain = { latDeg: 45, reportElevation: SEA + 0.01, moisture: 0.7, ice: 0, slope: 0.005 };

  it("ranks temperate well-watered plains above ice, desert, and steep peaks", () => {
    const good = cellSuitability(temperatePlain, SEA);
    const polarIce = cellSuitability({ latDeg: 85, reportElevation: SEA + 0.01, moisture: 0.7, ice: 1, slope: 0.005 }, SEA);
    const desert = cellSuitability({ latDeg: 20, reportElevation: SEA + 0.01, moisture: 0.05, ice: 0, slope: 0.005 }, SEA);
    const steepPeak = cellSuitability({ latDeg: 45, reportElevation: SEA + (1 - SEA) * 0.7, moisture: 0.7, ice: 0, slope: 0.2 }, SEA);
    expect(good).toBeGreaterThan(polarIce);
    expect(good).toBeGreaterThan(desert);
    expect(good).toBeGreaterThan(steepPeak);
  });

  it("never goes negative", () => {
    expect(cellSuitability({ latDeg: 90, reportElevation: 1, moisture: 0, ice: 1, slope: 1 }, SEA)).toBeGreaterThanOrEqual(0);
  });
});
