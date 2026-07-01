import { describe, expect, it } from "vitest";
import { KOPPEN_GLSL } from "../mapgen/gpu/koppen.glsl";
import {
  classifyKoppen,
  EARTH_CLIMATE,
  EVEREST_M,
  hadleyPrecipFactor,
  HIGHLAND,
  KOPPEN,
  KOPPEN_COLORS,
  KOPPEN_ZONE_COUNT,
  KZ,
  LAPSE_C_PER_M,
  LATITUDE_FALLOFF,
  MAT_EQUATOR_C,
  MAT_POLE_C,
  OCEAN_DEPTH_BANDS,
} from "./koppen";

// The Köppen classifier is the SINGLE source of biome colour + labels, mirrored in GLSL
// (koppen.glsl.ts) for the GPU field. Two guards against silent drift:
//   1. Behaviour — representative climate inputs must land in their Earth-sensible zones.
//   2. The CPU↔GPU mirror — every NUMBER in the GLSL twin is GENERATED from the TS objects
//      (glslConstBlock), so this parses the emitted block back and diffs it against the sources
//      (catching emitter breakage or a hand-edit sneaking back in), and pins the load-bearing
//      branch SHAPES by constant NAME (value-free, so retuning a threshold never breaks them —
//      only a structural/operator edit in one realm does). The FULL numeric CPU↔GPU field
//      comparison (RMS over a real GPU readback) lives in gpu-spike.ts; this is the CI-able guard.

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

  it("hot + bone-dry → hot desert (BWh); a little wetter → hot steppe (BSh)", () => {
    expect(zone(25, 30, 20, 25, 25, 0.1, 0.5)).toBe(KZ.BWh);
    expect(zone(25, 30, 20, 40, 25, 0.1, 0.5)).toBe(KZ.BSh);
  });

  it("polar lowland → ice sheet (EF) when no warm season, tundra (ET) when the summer thaws", () => {
    expect(zone(-20, -15, -25, 50, 80, 0.5, 0.5)).toBe(KZ.EF);
    expect(zone(-2, 5, -9, 200, 70, 0.5, 0.5)).toBe(KZ.ET);
    // The EF/ET edge is INCLUSIVE: a warmest month of exactly 0 °C never melts → still ice cap.
    expect(zone(-5, 0, -10, 300, 75, 0.5, 0.5)).toBe(KZ.EF);
  });

  it("temperate oceanic → Cfb; coastal subtropical → mediterranean (Csa)", () => {
    expect(zone(12, 18, 6, 1200, 50, 0.7, 0.5, 0.6)).toBe(KZ.Cfb);
    expect(zone(16, 24, 8, 500, 35, 0.4, 0.5, 0.2)).toBe(KZ.Csa); // coastal (low continentality) → dry-summer
  });

  it("a cold MOUNTAIN runs the highland ramp (alpine → bare rock → snow), not lowland tundra", () => {
    // High land elevation (landE ≈ 0.53) + a warm-season treeline → the geomorphic ramp by temperature.
    expect(zone(2, 6, -2, 400, 30, 0.5, 0.75)).toBe(KZ.ALPINE);
    expect(zone(-5, 2, -10, 300, 40, 0.5, 0.8)).toBe(KZ.BARE);
    expect(zone(-15, -10, -20, 200, 45, 0.5, 0.85)).toBe(KZ.EF);
    // ...the SAME coldness on low ground is polar tundra, not bare rock.
    expect(zone(-5, 2, -10, 300, 75, 0.5, 0.5)).toBe(KZ.ET);
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

// Pull `const float NAME = 1.23;` / `const int NAME = 3;` out of the emitted GLSL.
function glslConstants(src: string): { floats: Map<string, number>; ints: Map<string, number> } {
  const floats = new Map<string, number>();
  const ints = new Map<string, number>();
  const floatRe = /const\s+float\s+(\w+)\s*=\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*;/g;
  for (let m: RegExpExecArray | null; (m = floatRe.exec(src)); ) floats.set(m[1], parseFloat(m[2]));
  const intRe = /const\s+int\s+(\w+)\s*=\s*(-?\d+)\s*;/g;
  for (let m: RegExpExecArray | null; (m = intRe.exec(src)); ) ints.set(m[1], parseInt(m[2], 10));
  return { floats, ints };
}

describe("CPU↔GPU mirror — the GLSL constant blocks are generated from the TS sources", () => {
  const { floats, ints } = glslConstants(KOPPEN_GLSL);

  const expectFloats = (obj: Readonly<Record<string, number>>, prefix: string, skip: readonly string[] = []): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (skip.includes(k)) continue;
      expect(floats.get(`${prefix}${k}`), `GLSL const ${prefix}${k}`).toBe(v);
    }
  };

  it("EARTH_CLIMATE / KOPPEN / HIGHLAND / MAT / ocean-band constants round-trip exactly", () => {
    expectFloats(EARTH_CLIMATE, "");
    expectFloats(KOPPEN, "K_", ["WARM_MONTHS_FOR_B"]);
    expect(ints.get("K_WARM_MONTHS_FOR_B")).toBe(KOPPEN.WARM_MONTHS_FOR_B);
    expectFloats(HIGHLAND, "HIGHLAND_");
    expectFloats({ MAT_EQUATOR_C, MAT_POLE_C, LATITUDE_FALLOFF, LAPSE_C_PER_M, EVEREST_M }, "");
    expectFloats(OCEAN_DEPTH_BANDS, "OCEAN_");
  });

  it("every KZ zone id is generated into the GLSL", () => {
    for (const [k, v] of Object.entries(KZ)) expect(ints.get(`KZ_${k}`), `KZ_${k}`).toBe(v);
  });

  // The branch SHAPES the classifier's correctness hangs on, pinned by constant NAME (not value) —
  // retuning a threshold in koppen.ts can never break these; changing an operator or a branch in
  // ONE realm does. Keep each literally in sync with the TS classifier when the structure changes.
  const BRANCH_SHAPES = [
    "warmestMonthC <= K_ICE_CAP_WARM_MONTH_MAX_C", // EF is inclusive at exactly 0 °C
    "warmestMonthC < K_POLAR_WARM_MONTH_MAX_C", // ET below the polar line
    "temp >= K_TREE_MONTH_MIN_C", // a month AT the treeline temperature counts
    "K_ARIDITY_TEMP_MULTIPLIER * meanAnnual", // the aridity threshold formula
    "meanAnnual >= K_ARID_HOT_MEAN_ANNUAL_C", // desert/steppe h-vs-k split
    "coldestMonthC >= K_TROPICAL_COLD_MONTH_MIN_C", // tropical gate
    "coldestMonthC > K_TEMPERATE_COLD_MONTH_MIN_C", // C-vs-D split
    "landE > HIGHLAND_MOUNTAIN_LAND_E", // highland terrain override gate
    "driestSummer * K_DRY_SUMMER_WINTER_RATIO < wettestWinter", // s-letter rule
    "driestWinter * K_DRY_WINTER_SUMMER_RATIO < wettestSummer", // w-letter rule
    "d < OCEAN_DEEP_MAX_FRAC", // ocean depth banding
    "jitter * LAT_JITTER_DEG", // regime-latitude jitter (breaks the perfect-circle band edges)
    "min(90.0, abs(absLat + jLat))", // ...reflected at the equator, clamped at the pole (mirrors koppenZoneAt)
  ] as const;
  for (const shape of BRANCH_SHAPES) {
    it(`GLSL keeps the branch shape "${shape}"`, () => expect(KOPPEN_GLSL).toContain(shape));
  }
});
