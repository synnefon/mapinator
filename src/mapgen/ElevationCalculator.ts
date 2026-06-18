import type { NoiseFunction2D } from "simplex-noise";
import { printSection } from "../common/printUtils";
import { type RNG } from "../common/random";
import {
  CONTINENT_GAIN,
  CONTINENT_HI,
  CONTINENT_LACUNARITY,
  CONTINENT_LO,
  CONTINENT_OCTAVES,
  CONTINENT_SCALE,
  CONTINENT_WARP,
  DETAIL_AMPLITUDE,
  DIALS,
  FRACTAL_GAIN,
  FRACTAL_LACUNARITY,
  FRACTAL_OCTAVES,
  INLAND_HEIGHT,
  INVARIANTS,
  OCEAN_FLOOR,
  sampleDial,
} from "../common/settings";
import { clamp, lerp } from "../common/util";

/** smoothstep for shaping curves */
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Decorrelation offsets so the two domain-warp lookups don't mirror each other.
const WARP_OFFSET_X = 5.2;
const WARP_OFFSET_Y = 1.7;

/**
 * Continentalness-based elevation (model B).
 *  - A low-frequency, domain-warped noise field decides where continents sit.
 *  - A shaping curve maps that field to a base height (deep ocean → shelf → inland).
 *  - A multi-octave fractal rides on top as detail, producing wiggly coastlines
 *    and a natural hierarchy of island sizes.
 * The field is scale-free, so it reads as continents when zoomed out and as a
 * single coastline when zoomed in.
 */
export class ElevationCalculator {
  private noise2D: NoiseFunction2D;
  private fbmW1: number;

  constructor(rng: RNG, noise2D: NoiseFunction2D) {
    this.noise2D = noise2D;
    this.fbmW1 = sampleDial(DIALS.FBM2_W1_RANGE, rng);

    printSection("ELEVATION SETTINGS", { key: "fbmW1", value: this.fbmW1 });
  }

  /** Top-level elevation in [0,1]: continent base height + fractal detail. */
  public elevationAt(x: number, y: number, terrainFrequency: number): number {
    const C = this.continentalness(x, y);
    const base = lerp(
      OCEAN_FLOOR,
      INLAND_HEIGHT,
      smoothstep(CONTINENT_LO, CONTINENT_HI, C)
    );
    const detail =
      this.fbmFractal(x, y, terrainFrequency) - INVARIANTS.NEUTRAL_CENTER_POINT;
    return clamp(base + DETAIL_AMPLITUDE * detail);
  }

  /**
   * Low-frequency, domain-warped continent field → [0,1]. High where continents
   * sit, low over open ocean.
   */
  private continentalness(x: number, y: number): number {
    const wx =
      x + CONTINENT_WARP * this.continentNoise(x + WARP_OFFSET_X, y + WARP_OFFSET_Y);
    const wy =
      y + CONTINENT_WARP * this.continentNoise(x - WARP_OFFSET_Y, y - WARP_OFFSET_X);

    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < CONTINENT_OCTAVES; i++) {
      sum += amp * this.continentNoise(freq * wx, freq * wy);
      norm += amp;
      amp *= CONTINENT_GAIN;
      freq *= CONTINENT_LACUNARITY;
    }
    // sum/norm ∈ [-1,1] → [0,1]
    return INVARIANTS.NEUTRAL_CENTER_POINT * (1 + sum / norm);
  }

  /** Raw continent-scale noise (lower frequency than the terrain detail). */
  private continentNoise(x: number, y: number): number {
    return this.noise2D(x / CONTINENT_SCALE, y / CONTINENT_SCALE);
  }

  /**
   * Multi-octave fractal detail → ~[0,1], centered on 0.5. Spreads energy across
   * FRACTAL_OCTAVES scales for a natural hierarchy of coastal feature sizes.
   */
  private fbmFractal = (x: number, y: number, terrainFrequency: number) => {
    let amp = this.fbmW1;
    let freq = 1;
    let sum = 0;
    for (let i = 0; i < FRACTAL_OCTAVES; i++) {
      sum +=
        amp *
        this.noise2D(
          (freq * x) / terrainFrequency,
          (freq * y) / terrainFrequency
        );
      amp *= FRACTAL_GAIN;
      freq *= FRACTAL_LACUNARITY;
    }
    return clamp(INVARIANTS.NEUTRAL_CENTER_POINT + sum);
  };
}
