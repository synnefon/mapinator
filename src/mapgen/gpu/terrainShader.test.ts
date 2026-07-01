import { describe, expect, it } from "vitest";
import { INVARIANTS } from "../../common/settings";
import * as FC from "../fieldConstants";
import { FIELD_FRAG_SRC, FIELD_PARAM_UNIFORMS } from "./terrainShader";

// The GPU field shader's fixed (non-dial) constants are GENERATED from fieldConstants.ts. This parses
// the emitted const block back and asserts every shared constant matches its single CPU source — the
// guard on the emitter (and on hand-edits sneaking back into the template). The dial uniforms are
// driven by ONE table (FIELD_PARAM_UNIFORMS) that generates both the declarations and the uploads;
// the second describe cross-checks the table against the GLSL text in both directions. (Out of scope:
// the GLSL algorithm bodies — two-language by nature; gpu-spike.ts is their numeric harness.)

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
  REPORT_INLAND_RISE: FC.REPORT_INLAND_RISE,
  RIVER_ROUGH_WL: FC.RIVER_ROUGH_WAVELENGTH,
  RIVER_ROUGH_OCT: FC.RIVER_ROUGH_OCTAVES,
  RIVER_ROUGH_GAIN: FC.RIVER_ROUGH_GAIN,
  RIVER_ROUGH_LAC: FC.RIVER_ROUGH_LACUNARITY,
  NEUTRAL: INVARIANTS.NEUTRAL_CENTER_POINT,
  LAT_JITTER_DEG: FC.CLIMATE_LAT_JITTER_DEG,
  LAT_JITTER_OFF_X: FC.CLIMATE_LAT_JITTER_OFFSET_X,
  LAT_JITTER_OFF_Y: FC.CLIMATE_LAT_JITTER_OFFSET_Y,
  LAT_JITTER_OFF_Z: FC.CLIMATE_LAT_JITTER_OFFSET_Z,
  RANGE_ENV_WL: FC.RANGE_ENVELOPE_WAVELENGTH,
  RANGE_ENV_OFF: FC.RANGE_ENVELOPE_OFFSET,
  MOIST_OFF: FC.MOISTURE_NOISE_OFFSET,
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

describe("field uniforms — ONE table drives both the GLSL declarations and the uploads", () => {
  // Uniforms the shader declares but GpuField sets outside the table (non-scalar or call-time).
  const HAND_SET = new Set([
    "uShelf", "uLight", "uPlateCount", "uPlateTex", "uEmitReport", "uRiverRoughAmp",
    "uSites", "uPerm", "uWidth", "uCount",
  ]);

  const declared = new Set(
    [...FIELD_FRAG_SRC.matchAll(/uniform\s+\S+(?:\s+sampler2D)?\s+(\w+)\s*;/g)].map((m) => m[1])
  );
  // Identifiers used in the BODY (declaration lines stripped, so a declared-but-unused uniform
  // doesn't count itself as a use).
  const body = FIELD_FRAG_SRC.split("\n").filter((l) => !/^\s*uniform\b/.test(l)).join("\n");
  const used = new Set([...body.matchAll(/\bu[A-Z]\w*\b/g)].map((m) => m[0]));

  it("every table entry is declared in the GLSL and used by the body", () => {
    for (const spec of FIELD_PARAM_UNIFORMS) {
      expect(declared.has(spec.name), `declared: ${spec.name}`).toBe(true);
      expect(used.has(spec.name), `used: ${spec.name}`).toBe(true);
    }
  });

  it("every uniform used in the body is uploaded (table or hand-set) — no silent 0.0", () => {
    const uploaded = new Set([...FIELD_PARAM_UNIFORMS.map((s) => s.name), ...HAND_SET]);
    for (const name of used) {
      if (!declared.has(name)) continue; // a local that merely looks uniform-ish
      expect(uploaded.has(name), `uploaded: ${name}`).toBe(true);
    }
  });

  it("every declared uniform is exactly a table entry or a known hand-set one", () => {
    const expected = new Set([...FIELD_PARAM_UNIFORMS.map((s) => s.name), ...HAND_SET]);
    for (const name of declared) expect(expected.has(name), `known: ${name}`).toBe(true);
    expect(declared.size).toBe(expected.size); // and nothing expected is missing a declaration
  });
});
