import { createNoise3D } from "simplex-noise";
import { makeRNG } from "../../common/random";
import type { TerrainParams } from "../../common/settings";
import { ElevationCalculator } from "../ElevationCalculator";

// CPU reference for the GPU field benchmark/validation: the REAL production per-cell pipeline
// (ElevationCalculator.sampleCell over simplex-noise) computing the SAME fields the GPU does, so the
// agreement + speedup numbers are apples-to-apples. Range-based so the harness can chunk the 11M
// finest patch across event-loop yields instead of freezing the page.

export type CpuCalc = { calc: ElevationCalculator };
export type FieldArrays = {
  elevation: Float32Array;
  moisture: Float32Array;
  koppenZone: Float32Array;
  shade: Float32Array;
};

/** Build an ElevationCalculator for `seed`/`params` (its own seeded noise + tectonics). */
export function buildCpuCalc(seed: string, params: TerrainParams): CpuCalc {
  return { calc: new ElevationCalculator(createNoise3D(makeRNG(seed)), seed, params) };
}

/** Fill `out.*[start..end)` for all four fields via the real `sampleCell` — the CPU twin of the GPU
 *  field shader (the plate index is dropped; it's a base-mesh overlay, not a colour input). */
export function cpuFullFieldInto(
  { calc }: CpuCalc,
  sites: Float32Array,
  start: number,
  end: number,
  out: FieldArrays
): void {
  for (let i = start; i < end; i++) {
    const c = calc.sampleCell({ x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
    out.elevation[i] = c.elevation;
    out.moisture[i] = c.moisture;
    out.koppenZone[i] = c.koppenZone;
    out.shade[i] = c.shade;
  }
}
