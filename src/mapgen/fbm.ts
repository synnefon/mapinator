import type { NoiseFunction2D } from "simplex-noise";

/**
 * Multi-octave fractal (fBm) noise, centered on 0 (the summed octaves). Octave 0
 * has the given `amplitude` at the given `scale` (wavelength); each further octave
 * scales amplitude by `gain` and shrinks wavelength by `lacunarity`. Callers add a
 * baseline (e.g. 0.5) and/or clamp as needed.
 *
 * Shared by the elevation feature wave and the moisture wave.
 */
export function fbm(
  noise2D: NoiseFunction2D,
  x: number,
  y: number,
  scale: number,
  amplitude: number,
  octaves: number,
  gain: number,
  lacunarity: number
): number {
  let amp = amplitude;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D((freq * x) / scale, (freq * y) / scale);
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
}
