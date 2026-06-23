import { createNoise3D } from "simplex-noise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeRNG, type RNG } from "../common/random";
import { snapshotParams, TECTONIC } from "../common/settings";
import { Tectonics } from "./Tectonics";

// A uniform random point on the unit sphere (mirrors Tectonics' own randomUnit, for test points).
function randUnit(rng: RNG): [number, number, number] {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(t), r * Math.sin(t), z];
}

// Independently recompute the EXACT geodesic distance from p to the boundary between its two
// nearest plate seeds — the property the old 0.5·(θB−θA) approximation got wrong. Replicates
// upliftAt's nearest-two selection (and its tie-break) so we compare against the same boundary.
function trueBoundaryDistance(
  p: [number, number, number],
  seeds: Float32Array
): number {
  const k = seeds.length / 3;
  let iA = 0;
  let iB = 0;
  let dA = -Infinity;
  let dB = -Infinity;
  for (let i = 0; i < k; i++) {
    const d = p[0] * seeds[3 * i] + p[1] * seeds[3 * i + 1] + p[2] * seeds[3 * i + 2];
    if (d > dA) {
      dB = dA;
      iB = iA;
      dA = d;
      iA = i;
    } else if (d > dB) {
      dB = d;
      iB = i;
    }
  }
  const cx = seeds[3 * iB] - seeds[3 * iA];
  const cy = seeds[3 * iB + 1] - seeds[3 * iA + 1];
  const cz = seeds[3 * iB + 2] - seeds[3 * iA + 2];
  const chordLen = Math.hypot(cx, cy, cz) || 1;
  return Math.asin(Math.min(1, Math.abs(p[0] * cx + p[1] * cy + p[2] * cz) / chordLen));
}

describe("Tectonics.upliftAt — boundary-distance correctness", () => {
  // Disable the domain warp so test points stay in raw sphere coords; pin a known plate count.
  const saved = {
    sinuosity: TECTONIC.SINUOSITY.value,
    plateCount: TECTONIC.PLATE_COUNT.value,
    rangeWidth: TECTONIC.RANGE_WIDTH.value,
  };
  beforeAll(() => {
    TECTONIC.SINUOSITY.value = 0;
    TECTONIC.PLATE_COUNT.value = 14;
    TECTONIC.RANGE_WIDTH.value = 0.3;
  });
  afterAll(() => {
    TECTONIC.SINUOSITY.value = saved.sinuosity;
    TECTONIC.PLATE_COUNT.value = saved.plateCount;
    TECTONIC.RANGE_WIDTH.value = saved.rangeWidth;
  });

  const make = () => {
    const seed = "tectonics-test";
    // snapshotParams() captures the live TECTONIC dials this describe pinned in beforeAll.
    return new Tectonics(seed, createNoise3D(makeRNG(seed)), snapshotParams());
  };

  it("never raises a range beyond half the RANGE_WIDTH belt (the ballooning bug)", () => {
    const tec = make();
    const seeds = tec.seeds();
    const reach = Math.max(0.5 * TECTONIC.RANGE_WIDTH.value, 1e-6);
    const rng = makeRNG("uplift-samples");

    let raised = 0;
    let flat = 0;
    for (let i = 0; i < 4000; i++) {
      const p = randUnit(rng);
      const uplift = tec.upliftAt(p[0], p[1], p[2]);
      expect(uplift).toBeGreaterThanOrEqual(0);
      expect(uplift).toBeLessThanOrEqual(1);
      if (uplift > 0) {
        raised++;
        // band > 0 requires dist < reach; the old under-reading formula violated this off-midpoint.
        expect(trueBoundaryDistance(p, seeds)).toBeLessThanOrEqual(reach + 1e-9);
      } else {
        flat++;
      }
    }
    // sanity: the sample actually exercises both branches
    expect(raised).toBeGreaterThan(0);
    expect(flat).toBeGreaterThan(0);
  });

  it("is deterministic for a given seed + plate count", () => {
    const a = make();
    const b = make();
    const rng = makeRNG("determinism-samples");
    for (let i = 0; i < 200; i++) {
      const p = randUnit(rng);
      expect(a.upliftAt(p[0], p[1], p[2])).toBe(b.upliftAt(p[0], p[1], p[2]));
    }
  });
});
