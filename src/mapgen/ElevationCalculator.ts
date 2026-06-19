import type { NoiseFunction3D } from "simplex-noise";
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
import { fbm3 } from "./fbm";

/** smoothstep for shaping curves */
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Decorrelation offsets so the warp/erosion lookups don't mirror the base field.
const WARP_OFFSET_X = 5.2;
const WARP_OFFSET_Y = 1.7;
const WARP_OFFSET_Z = 9.3;
const EROSION_OFFSET_X = 11.3;
const EROSION_OFFSET_Y = 7.9;
const EROSION_OFFSET_Z = 3.1;

/**
 * Continentalness-based elevation (model B), sampled on the unit sphere.
 *  - CONTINENT carrier: a low-frequency, domain-warped 3D wave decides where
 *    continents sit, then a shaping curve maps it to a base height.
 *  - COAST + MOUNTAIN + OCEAN waves: relief blended ocean → shore → inland;
 *    amplitude modulated by the FEATURE_DETAIL ("erosion") wave.
 * 3D simplex on the sphere is seamless — no tiling, no pole artifacts.
 */
export class ElevationCalculator {
  private noise3D: NoiseFunction3D;
  private coastAmplitude: number;
  private mountainAmplitude: number;
  private continentWavelength: number;
  private continentWarp: number;
  private continentAmplitude: number;
  private erosionWavelength: number;
  private oceanAmplitude: number;

  constructor(rng: RNG, noise3D: NoiseFunction3D) {
    this.noise3D = noise3D;
    this.coastAmplitude = sampleDial(COAST.AMPLITUDE, rng);
    this.mountainAmplitude = sampleDial(MOUNTAIN.AMPLITUDE, rng);
    this.continentWavelength = sampleDial(CONTINENT.WAVELENGTH, rng);
    this.continentWarp = sampleDial(CONTINENT.WARP, rng);
    this.continentAmplitude = sampleDial(CONTINENT.AMPLITUDE, rng);
    this.erosionWavelength = sampleDial(FEATURE_DETAIL.WAVELENGTH, rng);
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

  /** Top-level elevation in [0,1] at a unit-sphere point: base + scaled relief. */
  public elevationAt(
    x: number,
    y: number,
    z: number,
    coastWavelength: number,
    mountainWavelength: number,
    oceanWavelength: number,
    extraOctaves: number
  ): number {
    const C = this.continentalness(x, y, z);
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
    const oceanRelief = fbm3(
      this.noise3D,
      x,
      y,
      z,
      oceanWavelength,
      this.oceanAmplitude,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const coastRelief = fbm3(
      this.noise3D,
      x,
      y,
      z,
      coastWavelength,
      this.coastAmplitude,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const mountainRelief = fbm3(
      this.noise3D,
      x,
      y,
      z,
      mountainWavelength,
      this.mountainAmplitude,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const landRelief = lerp(coastRelief, mountainRelief, inland);
    const relief = lerp(oceanRelief, landRelief, shelf);
    let r = this.erosionAmplitudeAt(x, y, z) * relief;
    // Relief may dig below sea level near the coast (bays, channels) but not deep
    // inland (no lakes). Upward relief (mountains) is never damped.
    if (r < 0) r *= 1 - INLAND_SINK_DAMP * inland;
    return clamp(base + r);
  }

  /**
   * Low-frequency, domain-warped, multi-octave carrier field → [0,1]. Owns the
   * land/water structure (continents + islands + coastlines); the relief waves
   * only add finer detail on top.
   */
  private continentalness(x: number, y: number, z: number): number {
    const wx =
      x + this.continentWarp * this.continentNoise(x + WARP_OFFSET_X, y + WARP_OFFSET_Y, z + WARP_OFFSET_Z);
    const wy =
      y + this.continentWarp * this.continentNoise(x - WARP_OFFSET_Y, y - WARP_OFFSET_Z, z - WARP_OFFSET_X);
    const wz =
      z + this.continentWarp * this.continentNoise(x + WARP_OFFSET_Z, y - WARP_OFFSET_X, z + WARP_OFFSET_Y);
    const sum = fbm3(
      this.noise3D,
      wx,
      wy,
      wz,
      this.continentWavelength,
      this.continentAmplitude,
      CONTINENT.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    return clamp(INVARIANTS.NEUTRAL_CENTER_POINT + sum);
  }

  /** Raw carrier-scale noise (lower frequency than the relief waves). */
  private continentNoise(x: number, y: number, z: number): number {
    return this.noise3D(
      x / this.continentWavelength,
      y / this.continentWavelength,
      z / this.continentWavelength
    );
  }

  /**
   * Erosion field → spatially-varying relief amplitude: a low-frequency wave gives
   * broad smooth regions (FEATURE_DETAIL.AMPLITUDE[0]) and rugged ones ([1]), so
   * one map has both flat plains and jagged highlands.
   */
  public erosionAmplitudeAt(x: number, y: number, z: number): number {
    const e = this.noise3D(
      x / this.erosionWavelength + EROSION_OFFSET_X,
      y / this.erosionWavelength + EROSION_OFFSET_Y,
      z / this.erosionWavelength + EROSION_OFFSET_Z
    );
    const t = INVARIANTS.NEUTRAL_CENTER_POINT * (1 + e);
    return lerp(FEATURE_DETAIL.AMPLITUDE[0], FEATURE_DETAIL.AMPLITUDE[1], t);
  }
}
