import type { TerrainParams } from "../../common/settings";
import { GpuField } from "./GpuField";
import { buildPermTextureData } from "./permTable";
import { buildPlateData } from "./plateData";

// Spike Step 1: does the GPU field path work INSIDE a worker (off the main thread, where generation
// lives)? This worker doesn't just create a context — it compiles the real field shader and runs an
// actual compute on a handful of sites, so a success is end-to-end proof, not just "getContext
// returned something". It reports the device + precision info the determinism verdict needs.

export type GpuProbeRequest = { seed: string; params: TerrainParams; sites: Float32Array };

export type GpuProbeResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      renderer: string;
      vendor: string;
      maxTextureSize: number;
      // getShaderPrecisionFormat(FRAGMENT_SHADER, HIGH_FLOAT): highp's actual precision drives the
      // cross-device determinism risk (a high-but-finite ULP that varies by GPU).
      highpFloat: { precision: number; rangeMin: number; rangeMax: number } | null;
      sample: number[]; // first few computed elevations — proof the field ran in the worker
      ms: number;
    };

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<GpuProbeRequest>) => {
  ctx.postMessage(probe(e.data));
};

function probe({ seed, params, sites }: GpuProbeRequest): GpuProbeResult {
  // OffscreenCanvas + webgl2 in the worker is the whole question of Step 1.
  if (typeof OffscreenCanvas === "undefined") return { ok: false, reason: "OffscreenCanvas unavailable in this worker" };
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext("webgl2");
  if (!gl) return { ok: false, reason: "getContext('webgl2') returned null in the worker" };

  const sampler = GpuField.create(gl);
  if (!sampler) return { ok: false, reason: "EXT_color_buffer_float (float render targets) unavailable" };

  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "(masked)";
  const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : "(masked)";
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);

  try {
    const result = sampler.compute(sites, params, buildPermTextureData(seed), buildPlateData(seed, params));
    const sample = Array.from(result.fields.elevation.slice(0, 6));
    sampler.dispose();
    return {
      ok: true,
      renderer,
      vendor,
      maxTextureSize: sampler.maxTextureSize,
      highpFloat: hp ? { precision: hp.precision, rangeMin: hp.rangeMin, rangeMax: hp.rangeMax } : null,
      sample,
      ms: result.timing.total,
    };
  } catch (err) {
    return { ok: false, reason: `compute threw in worker: ${String(err)}` };
  }
}
