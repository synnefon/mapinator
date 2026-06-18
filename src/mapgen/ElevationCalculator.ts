import type { NoiseFunction2D } from "simplex-noise";
import { printSection } from "../common/printUtils";
import { type RNG } from "../common/random";
import {
  CONTINENT,
  DIALS,
  ELEVATION,
  FRACTAL,
  INVARIANTS,
  sampleDial,
} from "../common/settings";
import { clamp, lerp } from "../common/util";
import { fbm } from "./fbm";

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
 *  - A shaping curve maps it to a base height (deep ocean → shelf → inland).
 *  - The shared fractal (fbm) rides on top as detail → coastlines + island sizes.
 * Scale-free, so it reads as continents zoomed out and one coastline zoomed in.
 */
export class ElevationCalculator {
  private noise2D: NoiseFunction2D;
  private fbmW1: number;

  constructor(rng: RNG, noise2D: NoiseFunction2D) {
    this.noise2D = noise2D;
    this.fbmW1 = sampleDial(DIALS.FBM_W1, rng);

    printSection("ELEVATION SETTINGS", { key: "fbmW1", value: this.fbmW1 });
  }

  /** Top-level elevation in [0,1]: continent base height + fractal detail. */
  public elevationAt(x: number, y: number, terrainFrequency: number): number {
    const C = this.continentalness(x, y);
    const base = lerp(
      CONTINENT.OCEAN_FLOOR,
      CONTINENT.INLAND_HEIGHT,
      smoothstep(CONTINENT.LO, CONTINENT.HI, C)
    );
    const detail = fbm(
      this.noise2D,
      x,
      y,
      terrainFrequency,
      this.fbmW1,
      FRACTAL.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    return clamp(base + ELEVATION.DETAIL_AMPLITUDE * detail);
  }

  /**
   * Low-frequency, domain-warped continent field → [0,1]. Single octave; the
   * fractal supplies all the finer coastline detail.
   */
  private continentalness(x: number, y: number): number {
    const wx =
      x + CONTINENT.WARP * this.continentNoise(x + WARP_OFFSET_X, y + WARP_OFFSET_Y);
    const wy =
      y + CONTINENT.WARP * this.continentNoise(x - WARP_OFFSET_Y, y - WARP_OFFSET_X);
    return INVARIANTS.NEUTRAL_CENTER_POINT * (1 + this.continentNoise(wx, wy));
  }

  /** Raw continent-scale noise (lower frequency than the terrain detail). */
  private continentNoise(x: number, y: number): number {
    return this.noise2D(x / CONTINENT.SCALE, y / CONTINENT.SCALE);
  }
}
