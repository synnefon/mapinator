import { describe, expect, it } from "vitest";
import { KOPPEN_GLSL } from "../mapgen/gpu/koppen.glsl";
import { classifyKoppen, hadleyPrecipFactor, KOPPEN_COLORS, KOPPEN_ZONE_COUNT, KZ } from "./koppen";

// The Köppen classifier is the SINGLE source of biome colour + labels, mirrored in GLSL (koppen.glsl.ts)
// for the GPU field. This locks two things against silent drift:
//   1. Behaviour — representative climate inputs must land in their Earth-sensible zones.
//   2. The CPU↔GPU mirror — the GLSL twin must carry the same branch thresholds (it's hand-mirrored, so a
//      threshold changed in one realm but not the other is the classic drift). The FULL numeric CPU↔GPU
//      field comparison (RMS over a real GPU readback) lives in gpu-spike.ts; this is the CI-able guard.

const SEA = 0.47;
// classifyKoppen(matC, tWarm, tCold, precipMm, absLatDeg, moisture, elevation, seaLevel, continentality)
const zone = (matC: number, tWarm: number, tCold: number, precipMm: number, absLat: number, moisture: number, elevation: number, continentality = 0.5): number =>
  classifyKoppen(matC, tWarm, tCold, precipMm, absLat, moisture, elevation, SEA, continentality);

describe("classifyKoppen — behaviour", () => {
  it("oceans bucket into three depth bands below the waterline", () => {
    expect(zone(20, 20, 20, 0, 10, 0.5, 0.05)).toBe(KZ.OCEAN_DEEP);
    expect(zone(20, 20, 20, 0, 10, 0.5, 0.25)).toBe(KZ.OCEAN_MID);
    expect(zone(20, 20, 20, 0, 10, 0.5, 0.45)).toBe(KZ.OCEAN_SHALLOW);
  });

  it("wet hot equator → tropical rainforest (Af)", () => {
    expect(zone(27, 28, 26, 2500, 5, 0.9, 0.5)).toBe(KZ.Af);
  });

  it("hot + dry → hot desert (BWh)", () => {
    expect(zone(25, 30, 20, 100, 25, 0.1, 0.5)).toBe(KZ.BWh);
  });

  it("polar lowland → ice sheet (EF) when no warm season, tundra (ET) when the summer thaws", () => {
    expect(zone(-20, -15, -25, 50, 80, 0.5, 0.5)).toBe(KZ.EF);
    expect(zone(-2, 5, -9, 200, 70, 0.5, 0.5)).toBe(KZ.ET);
  });

  it("temperate oceanic → Cfb; coastal subtropical → mediterranean (Csa)", () => {
    expect(zone(12, 18, 6, 1200, 50, 0.7, 0.5, 0.6)).toBe(KZ.Cfb);
    expect(zone(16, 24, 8, 500, 35, 0.4, 0.5, 0.2)).toBe(KZ.Csa); // coastal (low continentality) → dry-summer
  });

  it("a cold MOUNTAIN runs the highland ramp (alpine → bare rock → snow), not lowland tundra", () => {
    // High land elevation (landE ≈ 0.53) + a warm-season treeline → the geomorphic ramp by temperature.
    expect(zone(2, 6, -2, 400, 30, 0.5, 0.75)).toBe(KZ.ALPINE);
    expect(zone(-5, 0, -10, 300, 40, 0.5, 0.8)).toBe(KZ.BARE);
    expect(zone(-15, -10, -20, 200, 45, 0.5, 0.85)).toBe(KZ.EF);
    // ...the SAME coldness on low ground is polar tundra, not bare rock.
    expect(zone(-5, 0, -10, 300, 75, 0.5, 0.5)).toBe(KZ.ET);
  });

  it("every zone index has a palette colour", () => {
    for (let z = 0; z < KOPPEN_ZONE_COUNT; z++) expect(KOPPEN_COLORS[z]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("hadleyPrecipFactor — Earth's zonal rain bands", () => {
  it("is wettest at the equator, driest at the ±30° horse latitudes, with a mid-latitude bump", () => {
    expect(hadleyPrecipFactor(0, 1)).toBeGreaterThan(hadleyPrecipFactor(28, 1)); // ITCZ > horse latitudes
    expect(hadleyPrecipFactor(50, 1)).toBeGreaterThan(hadleyPrecipFactor(28, 1)); // storm track > horse latitudes
    expect(hadleyPrecipFactor(0, 1)).toBeGreaterThan(hadleyPrecipFactor(90, 1)); // equator > pole
  });
  it("is a no-op at strength 0 (rainfall stays moisture-only)", () => {
    for (const lat of [0, 15, 30, 50, 90]) expect(hadleyPrecipFactor(lat, 0)).toBeCloseTo(1, 10);
  });
});

describe("CPU↔GPU mirror — the GLSL twin carries the same branch thresholds", () => {
  // If a threshold changes in koppen.ts but not koppen.glsl.ts (or vice versa), the realms drift silently.
  // These are the load-bearing constants of the classifier; both realms must contain each literal.
  const SHARED_LITERALS = [
    "tWarm < 10.0", // polar / treeline
    "tCold >= 18.0", // tropical
    "matC >= 18.0", // desert h/k split
    "moisture > 0.82", // Af cutoff
    "moisture > 0.6", // Am cutoff
    "landE > 0.18", // mountain treeline
    "continentality < 0.45", // mediterranean = coastal
    "0.3 + 0.7", // Hadley precip floor + span
  ];
  for (const lit of SHARED_LITERALS) {
    it(`GLSL contains "${lit}"`, () => expect(KOPPEN_GLSL).toContain(lit));
  }
});
