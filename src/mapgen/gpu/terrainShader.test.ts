import { describe, expect, it } from "vitest";
import { INVARIANTS } from "../../common/settings";
import * as FC from "../fieldConstants";
import { FIELD_FRAG_SRC } from "./terrainShader";

// The GPU field shader hand-mirrors the CPU field's fixed (non-dial) constants — fieldConstants.ts. They
// MUST stay numerically identical or a GPU detail patch drifts from the CPU globe (a shifted coastline /
// mountains). This parses the shader's const block and asserts every shared constant matches its single
// CPU source, so drift fails the test suite rather than only showing up on the /gpu-spike harness.
// (Out of scope here: the dial-driven uniforms and the GLSL algorithm bodies — two-language by nature.)

// Pull `const float NAME = 1.23;` and `const vec3 NAME = vec3(a, b, c);` out of the shader source.
function glslConstants(src: string) {
  const num = "(-?\\d+(?:\\.\\d+)?)";
  const scalars = new Map<string, number>();
  const vec3s = new Map<string, [number, number, number]>();
  const scalarRe = new RegExp(`const\\s+float\\s+(\\w+)\\s*=\\s*${num}\\s*;`, "g");
  for (let m: RegExpExecArray | null; (m = scalarRe.exec(src)); ) scalars.set(m[1], parseFloat(m[2]));
  const vecRe = new RegExp(`const\\s+vec3\\s+(\\w+)\\s*=\\s*vec3\\(\\s*${num}\\s*,\\s*${num}\\s*,\\s*${num}\\s*\\)\\s*;`, "g");
  for (let m: RegExpExecArray | null; (m = vecRe.exec(src)); ) vec3s.set(m[1], [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  return { scalars, vec3s };
}

const { scalars, vec3s } = glslConstants(FIELD_FRAG_SRC);

// GLSL constant name → its single CPU source value.
const SHARED_SCALARS: Record<string, number> = {
  MIN_OCTAVE_AMPLITUDE: FC.MIN_OCTAVE_AMPLITUDE,
  RIDGE_FEEDBACK: FC.RIDGE_FEEDBACK,
  RIDGE_SHARPNESS: FC.RIDGE_SHARPNESS,
  LAND_HAIR: FC.LAND_HAIR,
  NEUTRAL: INVARIANTS.NEUTRAL_CENTER_POINT,
  RANGE_ENV_WL: FC.RANGE_ENVELOPE_WAVELENGTH,
  RANGE_ENV_OFF: FC.RANGE_ENVELOPE_OFFSET,
  MOIST_OFF: FC.MOISTURE_NOISE_OFFSET,
  ICE_RUFFLE_OFF: FC.ICE_RUFFLE_OFFSET,
  ICE_RUFFLE_FREQ: FC.ICE_RUFFLE_FREQ,
  ICE_HOLE_FREQ: FC.ICE_HOLE_FREQ,
  ICE_HOLE_SOFT: FC.ICE_HOLE_SOFTNESS,
  CONVERGENCE_SOFTNESS: FC.CONVERGENCE_SOFTNESS,
  JUNCTION_FADE_WIDTH: FC.JUNCTION_FADE_WIDTH,
  TEC_WARP_WL: FC.TECTONIC_WARP_WAVELENGTH,
  TEC_WARP_OFF_X: FC.TECTONIC_WARP_OFFSET_X,
  TEC_WARP_OFF_Y: FC.TECTONIC_WARP_OFFSET_Y,
  TEC_WARP_OFF_Z: FC.TECTONIC_WARP_OFFSET_Z,
};

describe("terrainShader GLSL constants mirror the CPU field (fieldConstants.ts)", () => {
  it("parses a plausible set of constants from the shader", () => {
    expect(scalars.size).toBeGreaterThan(10); // guard: the parser actually matched the const block
  });

  it("every shared scalar constant equals its single CPU source", () => {
    for (const [glslName, cpuValue] of Object.entries(SHARED_SCALARS)) {
      expect(scalars.get(glslName), `GLSL const ${glslName}`).toBe(cpuValue);
    }
  });

  it("the continent domain-warp vec3 matches the CPU offsets", () => {
    expect(vec3s.get("WARP_OFF")).toStrictEqual([
      FC.CONTINENT_WARP_OFFSET_X,
      FC.CONTINENT_WARP_OFFSET_Y,
      FC.CONTINENT_WARP_OFFSET_Z,
    ]);
  });
});
