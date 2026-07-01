import { createNoise3D } from "simplex-noise";
import { makeRNG } from "../../common/random";
import type { TerrainParams } from "../../common/settings";
import { clamp, smoothstep } from "../../common/util";
import { ElevationCalculator } from "../ElevationCalculator";
import { LAND_HAIR, REPORT_INLAND_RISE } from "../fieldConstants";

// CPU reference for the GPU field benchmark/validation: the REAL production per-cell pipeline
// (ElevationCalculator.sampleCell over simplex-noise) computing the SAME fields the GPU does, so the
// agreement + speedup numbers are apples-to-apples. Range-based so the harness can chunk the 11M
// finest patch across event-loop yields instead of freezing the page.

export type CpuCalc = { calc: ElevationCalculator; params: TerrainParams };
export type FieldArrays = {
  elevation: Float32Array;
  moisture: Float32Array;
  koppenZone: Float32Array;
  shade: Float32Array;
};

/** Build an ElevationCalculator for `seed`/`params` (its own seeded noise + tectonics). */
export function buildCpuCalc(seed: string, params: TerrainParams): CpuCalc {
  return { calc: new ElevationCalculator(createNoise3D(makeRNG(seed)), seed, params), params };
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

/**
 * The CPU twin of GpuField.computeRiverField — the fields RIVER ROUTING reads, at `sites`. Its
 * reportElevation is the shader's uEmitReport ROUTING height, not sampleCell's: ocean keeps its depth
 * (a flow sink); land gets the continentalness-driven coast→interior rise (REPORT_INLAND_RISE) plus
 * the real mountain relief, then `riverRoughAmp` × the micro-relief fbm — so tests and validation
 * route on the SAME height shape production does (terrainShader.ts reportElevationAt + field()).
 */
export function cpuRiverField(
  { calc, params }: CpuCalc,
  sites: Float32Array,
  riverRoughAmp: number
): { elevation: Float32Array; moisture: Float32Array; ice: Float32Array; reportElevation: Float32Array } {
  const n = (sites.length / 3) | 0;
  const seaLevel = params.OCEANS.SEA_LEVEL;
  const shelfHigh = params.OCEANS.SHELF[1];
  const elevation = new Float32Array(n);
  const moisture = new Float32Array(n);
  const ice = new Float32Array(n);
  const reportElevation = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const site = { x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] };
    const c = calc.sampleCell(site);
    elevation[i] = c.elevation;
    moisture[i] = c.moisture;
    ice[i] = c.ice;
    if (c.elevation < seaLevel) {
      reportElevation[i] = c.elevation; // ocean: keep its depth (a flow sink)
      continue;
    }
    const { full } = calc.continentalness(site.x, site.y, site.z, params.MOISTURE.WATER_SIZE_OCTAVES);
    const inland = smoothstep(shelfHigh, 1, full);
    const mtn = Math.max(0, c.elevation - (seaLevel + LAND_HAIR));
    reportElevation[i] =
      clamp(seaLevel + inland * REPORT_INLAND_RISE + mtn) + riverRoughAmp * calc.riverRoughnessAt(site);
  }
  return { elevation, moisture, ice, reportElevation };
}
