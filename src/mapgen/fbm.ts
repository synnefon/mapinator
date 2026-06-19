import type { NoiseFunction3D } from "simplex-noise";

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
  let amp = amplitude;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3D((freq * x) / scale, (freq * y) / scale, (freq * z) / scale);
    amp *= gain;
    freq *= lacunarity;
  }
  return sum;
}
