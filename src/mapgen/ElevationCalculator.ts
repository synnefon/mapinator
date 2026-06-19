import type { NoiseFunction2D } from "simplex-noise";
import { printSection } from "../common/printUtils";
import { type RNG } from "../common/random";
import {
  COAST,
  CONTINENT,
  FEATURE_DETAIL,
  FRACTAL,
  INLAND_SINK_DAMP,
  INVARIANTS,
  MOUNTAIN,
  OCEAN,
  sampleDial,
} from "../common/settings";
import { clamp, lerp } from "../common/util";
import { fbm } from "./fbm";

/** smoothstep for shaping curves */
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Decorrelation offsets so the warp/erosion lookups don't mirror the base field.
const WARP_OFFSET_X = 5.2;
const WARP_OFFSET_Y = 1.7;
const EROSION_OFFSET_X = 11.3;
const EROSION_OFFSET_Y = 7.9;

/**
 * Continentalness-based elevation (model B).
 *  - CONTINENT carrier: a low-frequency, domain-warped wave decides where
 *    continents sit, then a shaping curve maps it to a base height.
 *  - COAST + MOUNTAIN waves: a fine and a coarse fractal ride on top as relief,
 *    blended by the inland ramp; amplitude is modulated by the FEATURE_DETAIL
 *    ("erosion") wave (smooth vs rugged regions).
 * Carrier wavelength/warp are sampled per seed; the whole field is scale-free.
 */
export class ElevationCalculator {
  private noise2D: NoiseFunction2D;
  private coastAmplitude: number;
  private mountainAmplitude: number;
  private continentWavelength: number;
  private continentWarp: number;
  private continentAmplitude: number;
  private erosionWavelength: number;
  private oceanAmplitude: number;

  constructor(rng: RNG, noise2D: NoiseFunction2D) {
    this.noise2D = noise2D;
    this.coastAmplitude = sampleDial(COAST.AMPLITUDE, rng);
    this.mountainAmplitude = sampleDial(MOUNTAIN.AMPLITUDE, rng);
    this.continentWavelength = sampleDial(CONTINENT.WAVELENGTH, rng);
    this.continentWarp = sampleDial(CONTINENT.WARP, rng);
    this.continentAmplitude = sampleDial(CONTINENT.AMPLITUDE, rng);
    this.erosionWavelength = sampleDial(FEATURE_DETAIL.WAVELENGTH, rng);
    // Appended last so adding it doesn't reshuffle the continent/erosion dials per seed.
    this.oceanAmplitude = sampleDial(OCEAN.AMPLITUDE, rng);

    printSection(
      "ELEVATION SETTINGS",
      { key: "coastAmplitude", value: this.coastAmplitude },
      { key: "mountainAmplitude", value: this.mountainAmplitude },
      { key: "continentWavelength", value: this.continentWavelength },
      { key: "continentWarp", value: this.continentWarp },
      { key: "continentAmplitude", value: this.continentAmplitude },
      { key: "erosionWavelength", value: this.erosionWavelength },
      { key: "oceanAmplitude", value: this.oceanAmplitude }
    );
  }

  /** Top-level elevation in [0,1]: continent base height + erosion-scaled relief. */
  public elevationAt(
    x: number,
    y: number,
    coastWavelength: number,
    mountainWavelength: number,
    oceanWavelength: number
  ): number {
    const C = this.continentalness(x, y);
    // Shelf ramp: 0 out in open ocean → 1 once fully inland. Sets the base height
    // and blends ocean relief into land relief across the continental shelf.
    const shelf = smoothstep(CONTINENT.SHELF[0], CONTINENT.SHELF[1], C);
    // Below the shelf, depth tracks the carrier: deepest abyss at C=0 rising to the
    // shelf-edge floor; above it, the shelf-edge floor rises to the inland peak.
    const base =
      C < CONTINENT.SHELF[0]
        ? lerp(
            CONTINENT.ABYSS_HEIGHT,
            CONTINENT.BASE_HEIGHT[0],
            smoothstep(0, CONTINENT.SHELF[0], C)
          )
        : lerp(CONTINENT.BASE_HEIGHT[0], CONTINENT.BASE_HEIGHT[1], shelf);
    // Coast → inland ramp: 0 at the shoreline, 1 deep inland. Drives both the
    // coast/mountain amplitude blend and the downward sink-damp.
    const inland = smoothstep(CONTINENT.SHELF[1], 1, C);
    // Three relief waves, ocean → shore → inland: a gentle OCEAN swell in deep
    // water, fine COAST jaggedness at the shore, broad MOUNTAIN relief inland.
    const oceanRelief = fbm(
      this.noise2D,
      x,
      y,
      oceanWavelength,
      this.oceanAmplitude,
      FRACTAL.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const coastRelief = fbm(
      this.noise2D,
      x,
      y,
      coastWavelength,
      this.coastAmplitude,
      FRACTAL.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const mountainRelief = fbm(
      this.noise2D,
      x,
      y,
      mountainWavelength,
      this.mountainAmplitude,
      FRACTAL.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const landRelief = lerp(coastRelief, mountainRelief, inland);
    const relief = lerp(oceanRelief, landRelief, shelf);
    let r = this.erosionAmplitudeAt(x, y) * relief;
    // Relief may dig below sea level near the coast (bays, channels) but not deep
    // inland (no lakes). Upward relief (mountains) is never damped.
    if (r < 0) r *= 1 - INLAND_SINK_DAMP * inland;
    return clamp(base + r);
  }

  /**
   * Low-frequency, domain-warped, multi-octave carrier field → [0,1]. Owns the
   * land/water structure (continents + islands + coastlines); the feature wave
   * only adds finer relief on top.
   */
  private continentalness(x: number, y: number): number {
    const wx =
      x + this.continentWarp * this.continentNoise(x + WARP_OFFSET_X, y + WARP_OFFSET_Y);
    const wy =
      y + this.continentWarp * this.continentNoise(x - WARP_OFFSET_Y, y - WARP_OFFSET_X);
    const sum = fbm(
      this.noise2D,
      wx,
      wy,
      this.continentWavelength,
      this.continentAmplitude,
      CONTINENT.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    return clamp(INVARIANTS.NEUTRAL_CENTER_POINT + sum);
  }

  /** Raw carrier-scale noise (lower frequency than the feature wave). */
  private continentNoise(x: number, y: number): number {
    return this.noise2D(x / this.continentWavelength, y / this.continentWavelength);
  }

  /**
   * Erosion field → spatially-varying feature amplitude: a low-frequency wave
   * gives broad smooth regions (FEATURE_DETAIL.AMPLITUDE[0]) and rugged ones ([1]),
   * so one map has both flat plains and jagged highlands.
   */
  private erosionAmplitudeAt(x: number, y: number): number {
    const e = this.noise2D(
      x / this.erosionWavelength + EROSION_OFFSET_X,
      y / this.erosionWavelength + EROSION_OFFSET_Y
    );
    const t = INVARIANTS.NEUTRAL_CENTER_POINT * (1 + e);
    return lerp(FEATURE_DETAIL.AMPLITUDE[0], FEATURE_DETAIL.AMPLITUDE[1], t);
  }
}
