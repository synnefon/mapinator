import { describe, expect, it } from "vitest";
import { makeRNG } from "../../common/random";
import { generateGovernment } from "./government";
import { estimatePopulation } from "./population";

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
  const gov = { type: "republic", densityFactor: 1, govType: { word: "republic", tags: {} } };
  const inputs = (effectiveAreaKm2: number, jitter = 0.5) => ({ effectiveAreaKm2, government: gov, jitter });

  it("scales with the suitability-weighted habitable area", () => {
    expect(estimatePopulation(inputs(2_000_000))).toBeGreaterThan(estimatePopulation(inputs(1_000_000)));
  });

  it("scales with the government's density factor", () => {
    const pop = (densityFactor: number) =>
      estimatePopulation({
        effectiveAreaKm2: 1e6,
        government: { type: "x", densityFactor, govType: { word: "x", tags: {} } },
        jitter: 0.5,
      });
    expect(pop(1.3)).toBeGreaterThan(pop(0.7));
  });

  it("scales with the per-country variation jitter", () => {
    expect(estimatePopulation(inputs(1e6, 1))).toBeGreaterThan(estimatePopulation(inputs(1e6, 0)));
  });

  it("returns a non-negative integer", () => {
    const p = estimatePopulation(inputs(1_234_567));
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
  });

  it("is zero when there is no habitable area", () => {
    expect(estimatePopulation(inputs(0))).toBe(0);
  });
});
