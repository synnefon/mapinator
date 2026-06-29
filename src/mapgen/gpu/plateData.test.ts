import { createNoise3D } from "simplex-noise";
import { describe, expect, it } from "vitest";
import { makeRNG } from "../../common/random";
import { snapshotParams, type TerrainParams } from "../../common/settings";
import { Tectonics } from "../Tectonics";
import { buildPlateData } from "./plateData";

// buildPlateData must reproduce Tectonics' internal plate seeds exactly, or the GPU's mountains land in
// different places than the CPU globe's. Tectonics only exposes seeds() publicly, so we pin to that
// (the poles come from the same interleaved RNG stream, so matching seeds ⇒ matching poles).
function withPlateCount(n: number): TerrainParams {
  const p = snapshotParams();
  return { ...p, TECTONICS: { ...p.TECTONICS, PLATE_COUNT: n } };
}

describe("buildPlateData", () => {
  it("reproduces Tectonics' plate seeds exactly", () => {
    for (const seed of ["ATLANTIS", "PANGAEA"]) {
      for (const count of [2, 22, 33]) {
        const params = withPlateCount(count);
        const tect = new Tectonics(seed, createNoise3D(makeRNG(seed)), params);
        const data = buildPlateData(seed, params);
        expect(data.count).toBe(count);
        expect(Array.from(data.seeds)).toStrictEqual(Array.from(tect.seeds()));
      }
    }
  });

  it("emits unit-length seeds and poles", () => {
    const data = buildPlateData("ATLANTIS", withPlateCount(22));
    for (const arr of [data.seeds, data.poles]) {
      for (let i = 0; i < data.count; i++) {
        const len = Math.hypot(arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]);
        expect(len).toBeCloseTo(1, 6);
      }
    }
  });
});
