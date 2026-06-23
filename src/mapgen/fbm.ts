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

// Ridged-multifractal feedback gain: each octave is weighted by the PREVIOUS one, so fine
// detail piles onto ridgelines and valleys stay smooth — the branched, dendritic crest
// structure of real mountain ranges. Higher = sharper, more branched; ~1 = nearly plain.
const RIDGE_FEEDBACK = 2.5;
// Crest sharpness: (1 - |noise|) raised to this power. Higher = narrower, POINTIER peaks with
// broader valleys; 2 = rounded ridges, 3–5 = increasingly spiky.
const RIDGE_SHARPNESS = 3.5;

/**
 * Ridged-multifractal noise (Musgrave) over a 3D position, in [0, amplitude]. Unlike fBm's
 * rounded lumps, the `1 - |noise|` fold makes sharp CRESTS where the noise crosses zero, and
 * the per-octave weight feedback concentrates detail along those crests — so it reads as a
 * mountain range (ridgelines + carved valleys) rather than rolling hills. Same octave / gain
 * / lacunarity knobs as fbm3, and the same fractional-top-octave fade for smooth zoom LOD.
 */
export function ridgedFbm3(
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
  const inv = 1 / scale;
  let sx = x * inv;
  let sy = y * inv;
  let sz = z * inv;
  let amp = 1; // octave weight (normalized); the whole result is scaled by `amplitude` at the end
  let weight = 1; // ridged feedback: the previous octave's crest gates the next octave's detail
  let sum = 0;
  let norm = 0; // running Σ amp, so the result normalizes to [0, amplitude] regardless of octaves
  const ridge = (): number => {
    let n = 1 - Math.abs(noise3D(sx, sy, sz)); // crest where noise ≈ 0
    n = Math.pow(n, RIDGE_SHARPNESS); // sharpen the crest → pointier peaks
    n *= weight;
    weight = Math.min(1, n * RIDGE_FEEDBACK); // next octave only detailed under this ridge
    return n;
  };
  const whole = Math.floor(octaves);
  for (let i = 0; i < whole; i++) {
    sum += ridge() * amp;
    norm += amp;
    amp *= gain;
    sx *= lacunarity;
    sy *= lacunarity;
    sz *= lacunarity;
  }
  const frac = octaves - whole;
  if (frac > 0) {
    const w = smoothstep(0, 1, frac);
    sum += ridge() * amp * w;
    norm += amp * w;
  }
  return norm > 0 ? (amplitude * sum) / norm : 0;
}
