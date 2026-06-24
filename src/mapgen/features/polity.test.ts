import { describe, expect, it } from "vitest";
import { makeRNG } from "../../common/random";
import { generateGovernment } from "./government";
import { climateHabitability, estimatePopulation, latitudeHabitability } from "./population";

describe("generateGovernment", () => {
  it("is deterministic and composes 2–3 word titles with a positive density factor", () => {
    const a = generateGovernment(makeRNG("seed-a"));
    const b = generateGovernment(makeRNG("seed-a"));
    expect(a).toStrictEqual(b);
    const words = a.type.split(" ");
    expect(words.length === 2 || words.length === 3).toBe(true);
    expect(a.densityFactor).toBeGreaterThan(0);
  });

  it("never repeats a word within one name", () => {
    for (let i = 0; i < 60; i++) {
      const words = generateGovernment(makeRNG(`g${i}`)).type.split(" ");
      expect(words.length === 2 || words.length === 3).toBe(true);
      expect(new Set(words).size).toBe(words.length);
    }
  });
});

describe("estimatePopulation", () => {
  const gov = { type: "republic", densityFactor: 1 };
  const ctx = (areaKm2: number, latitudeDeg = 40) => ({ areaKm2, latitudeDeg, government: gov, climate: 1, jitter: 0.5 });

  it("scales with area, all else equal", () => {
    expect(estimatePopulation(ctx(2_000_000))).toBeGreaterThan(estimatePopulation(ctx(1_000_000)));
  });

  it("favours temperate latitudes over polar", () => {
    expect(latitudeHabitability(40)).toBeGreaterThan(latitudeHabitability(85));
    expect(estimatePopulation(ctx(1e6, 40))).toBeGreaterThan(estimatePopulation(ctx(1e6, 85)));
  });

  it("scales with the government's density factor", () => {
    const pop = (densityFactor: number) =>
      estimatePopulation({ areaKm2: 1e6, latitudeDeg: 40, government: { type: "x", densityFactor }, climate: 1, jitter: 0.5 });
    expect(pop(1.3)).toBeGreaterThan(pop(0.7));
  });

  it("favours green climates over barren ones", () => {
    const pop = (climate: number) =>
      estimatePopulation({ areaKm2: 1e6, latitudeDeg: 40, government: gov, climate, jitter: 0.5 });
    expect(pop(1.2)).toBeGreaterThan(pop(0.2)); // lush green land outpopulates desert / ice
  });

  it("returns a non-negative integer", () => {
    const p = estimatePopulation(ctx(1_234_567));
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });
});

describe("climateHabitability", () => {
  it("ranks lush green land above grassland above desert", () => {
    const forest = climateHabitability("WET", "LOW", 0);
    const plains = climateHabitability("MID", "LOW", 0);
    const desert = climateHabitability("DRY", "LOW", 0);
    expect(forest).toBeGreaterThan(plains);
    expect(plains).toBeGreaterThan(desert);
  });

  it("drops habitability for mountains and ice", () => {
    const lowland = climateHabitability("WET", "LOW", 0);
    expect(climateHabitability("WET", "VERY_HIGH", 0)).toBeLessThan(lowland); // snow-capped peaks
    expect(climateHabitability("WET", "LOW", 1)).toBeLessThan(lowland); // full ice cap
  });
});
