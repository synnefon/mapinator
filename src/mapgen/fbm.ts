import type { NoiseFunction3D } from "simplex-noise";
import { smoothstep } from "../common/util";

// An octave whose amplitude is below this contributes less than ~0.6% of a unit
// field — well under the renderer's 5-bit colour quantization (~3.2% per channel),
// so it can't move a pixel. Amplitude only shrinks (gain < 1), so once we're under
// it every remaining octave is too. This trims only the deep tail of very-low-
// amplitude waves (e.g. the gentle OCEAN swell) at high zoom; the base octave count
// and all visible detail are untouched.
const MIN_OCTAVE_AMPLITUDE = 0.006;

/**
 * Multi-octave fractal (fBm) noise over a 3D position, centered on 0 (the summed
 * octaves). Octave 0 has the given `amplitude` at the given `scale` (wavelength);
 * each further octave scales amplitude by `gain` and shrinks wavelength by
 * `lacunarity`. Callers add a baseline (e.g. 0.5) and/or clamp as needed.
 *
 * The world is a sphere: we sample 3D simplex noise at points on the unit sphere,
 * which is seamless everywhere (no tiling, no pole artifacts). Shared by the
 * elevation relief waves and the moisture wave.
 */
export function fbm3(
  noise3D: NoiseFunction3D,
  x: number,
  y: number,
  z: number,
  scale: number,
  amplitude: number,
  octaves: number,
  gain: number,
  lacunarity: number
): number {
  // Hoist 1/scale and walk the coordinates by `lacunarity` each octave, so the
  // hot loop does multiplies only — no per-octave divisions or freq*coord work.
  const inv = 1 / scale;
  let sx = x * inv;
  let sy = y * inv;
  let sz = z * inv;
  let amp = amplitude;
  let sum = 0;
  // Whole octaves at full weight; the fractional remainder is faded in below.
  const whole = Math.floor(octaves);
  for (let i = 0; i < whole; i++) {
    if (amp < MIN_OCTAVE_AMPLITUDE) break; // remaining octaves are imperceptible
    sum += amp * noise3D(sx, sy, sz);
    amp *= gain;
    sx *= lacunarity;
    sy *= lacunarity;
    sz *= lacunarity;
  }
  // Fractional top octave: fade in by amplitude (smoothstep) so the detail added as a
  // caller raises `octaves` with zoom emerges continuously, not as a whole wave popping in.
  const frac = octaves - whole;
  if (frac > 0 && amp >= MIN_OCTAVE_AMPLITUDE) {
    sum += amp * smoothstep(0, 1, frac) * noise3D(sx, sy, sz);
  }
  return sum;
}
