import type { NoiseFunction2D } from "simplex-noise";

/**
 * Multi-octave fractal (fBm) noise, centered on 0 (the summed octaves). Each
 * octave samples at `lacunarity`× the frequency and `gain`× the amplitude of the
 * previous one. Callers add a baseline (e.g. 0.5) and/or clamp as needed.
 *
 * Shared by elevation detail and moisture so they get the same organic,
 * scale-spanning noise from one place.
 */
export function fbm(
  noise2D: NoiseFunction2D,
  x: number,
  y: number,
  frequency: number,
  amplitude: number,
  octaves: number,
  gain: number,
  lacunarity: number
): number {
  let amp = amplitude;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2D((freq * x) / frequency, (freq * y) / frequency);
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
}
