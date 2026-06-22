import type { NoiseFunction3D } from "simplex-noise";
import type { Vec3 } from "../common/3DMath";
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
import { clamp, lerp, smoothstep } from "../common/util";
import { fbm3 } from "./fbm";

/** Relief wavelengths + octave depth for elevationAt, bundled so the call site
 * isn't a long list of interchangeable numbers. */
export type ReliefConfig = {
  coastWavelength: number;
  mountainWavelength: number;
  oceanWavelength: number;
  extraOctaves: number;
};

// Decorrelation offsets so the warp/erosion lookups don't mirror the base field.
const WARP_OFFSET_X = 5.2;
const WARP_OFFSET_Y = 1.7;
const WARP_OFFSET_Z = 9.3;
const EROSION_OFFSET_X = 11.3;
const EROSION_OFFSET_Y = 7.9;
const EROSION_OFFSET_Z = 3.1;
const WARP_VAR_OFFSET_X = 17.4;
const WARP_VAR_OFFSET_Y = 23.1;
const WARP_VAR_OFFSET_Z = 8.6;

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
  private continentAmplitude: number;
  private erosionWavelength: number;
  private oceanAmplitude: number;

  constructor(rng: RNG, noise3D: NoiseFunction3D) {
    this.noise3D = noise3D;
    this.coastAmplitude = sampleDial(COAST.AMPLITUDE, rng);
    this.mountainAmplitude = sampleDial(MOUNTAIN.AMPLITUDE, rng);
    this.continentWavelength = sampleDial(CONTINENT.WAVELENGTH, rng);
    this.continentAmplitude = sampleDial(CONTINENT.AMPLITUDE, rng);
    this.erosionWavelength = sampleDial(FEATURE_DETAIL.WAVELENGTH, rng);
    this.oceanAmplitude = sampleDial(OCEAN.AMPLITUDE, rng);
  }

  /**
   * Top-level elevation in [0,1] at a unit-sphere point: base + scaled relief.
   * `erosion` is the FEATURE_DETAIL amplitude and `C` the continentalness at this point; the
   * caller passes both in (see continentalnessAt) so they aren't recomputed here and again for
   * moisture / water-proximity.
   */
  public elevationAt(
    site: Vec3,
    reliefCfg: ReliefConfig,
    erosion: number,
    C: number
  ): number {
    const { x, y, z } = site;
    const { coastWavelength, mountainWavelength, oceanWavelength, extraOctaves } =
      reliefCfg;
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

    // Relief blends ocean → shore → inland: a gentle OCEAN swell in deep water,
    // fine COAST jaggedness at the shore, broad MOUNTAIN relief inland. Each wave's
    // weight (shelf / inland) saturates to exactly 0 or 1 outside its band, so we
    // evaluate only the waves that actually contribute. Most cells are open ocean
    // (shelf = 0 → ocean only) or deep interior (shelf = 1 → land only), skipping
    // one or two fBm evaluations with bit-identical output.
    let relief: number;
    if (shelf <= 0) {
      relief = this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, extraOctaves);
    } else {
      const land = this.landRelief(
        x, y, z, coastWavelength, mountainWavelength, inland, extraOctaves
      );
      relief =
        shelf >= 1
          ? land
          : lerp(
              this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, extraOctaves),
              land,
              shelf
            );
    }

    let r = erosion * relief;
    // Relief may dig below sea level near the coast (bays, channels) but not deep
    // inland (no lakes). Upward relief (mountains) is never damped.
    if (r < 0) r *= 1 - INLAND_SINK_DAMP * inland;
    return clamp(base + r);
  }

  /** One relief fBm wave (shared fractal shape; only wavelength + amplitude vary). */
  private relief(
    x: number,
    y: number,
    z: number,
    wavelength: number,
    amplitude: number,
    extraOctaves: number
  ): number {
    return fbm3(
      this.noise3D,
      x,
      y,
      z,
      wavelength,
      amplitude,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
  }

  /** Land relief: fine COAST at the shore → broad MOUNTAIN inland, blended by
   * `inland`. Skips whichever wave has zero weight at the saturated ends. */
  private landRelief(
    x: number,
    y: number,
    z: number,
    coastWavelength: number,
    mountainWavelength: number,
    inland: number,
    extraOctaves: number
  ): number {
    if (inland <= 0) {
      return this.relief(x, y, z, coastWavelength, this.coastAmplitude, extraOctaves);
    }
    const mountain = this.relief(
      x, y, z, mountainWavelength, this.mountainAmplitude, extraOctaves
    );
    if (inland >= 1) return mountain;
    const coast = this.relief(
      x, y, z, coastWavelength, this.coastAmplitude, extraOctaves
    );
    return lerp(coast, mountain, inland);
  }

  /**
   * Continentalness carrier sampled twice from ONE domain-warp: `full` (CONTINENT.OCTAVES — the
   * land/water + relief structure that drives terrain) and `broad` (only `broadOctaves` low-
   * frequency octaves → just the big land/water masses, ignoring small lakes/islands). The
   * maritime moisture layer takes min(full, broad), so a big ocean projects humidity far inland
   * while an oasis only does so locally. Computed once per cell, shared by elevation + moisture.
   */
  public continentalness(
    x: number,
    y: number,
    z: number,
    broadOctaves: number
  ): { full: number; broad: number } {
    const warp = this.warpAmount(x, y, z); // varies across the map (very-low-freq wave)
    const wx =
      x + warp * this.continentNoise(x + WARP_OFFSET_X, y + WARP_OFFSET_Y, z + WARP_OFFSET_Z);
    const wy =
      y + warp * this.continentNoise(x - WARP_OFFSET_Y, y - WARP_OFFSET_Z, z - WARP_OFFSET_X);
    const wz =
      z + warp * this.continentNoise(x + WARP_OFFSET_Z, y - WARP_OFFSET_X, z + WARP_OFFSET_Y);
    const base = INVARIANTS.NEUTRAL_CENTER_POINT;
    const full =
      base +
      fbm3(
        this.noise3D, wx, wy, wz, this.continentWavelength,
        this.continentAmplitude, CONTINENT.OCTAVES, FRACTAL.GAIN, FRACTAL.LACUNARITY
      );
    // Same warp + wavelength, fewer octaves → a low-pass of `full` (the big structures only).
    const broad =
      base +
      fbm3(
        this.noise3D, wx, wy, wz, this.continentWavelength,
        this.continentAmplitude, broadOctaves, FRACTAL.GAIN, FRACTAL.LACUNARITY
      );
    return { full: clamp(full), broad: clamp(broad) };
  }

  /**
   * Domain-warp strength at a point, varied across the map by a very-low-frequency wave
   * (CONTINENT.WARP_VAR_WAVELENGTH) between CONTINENT.WARP's min/max — so some regions
   * get wandering, organic coasts and others smoother ones. It's a function of position,
   * so it's identical at every zoom level (the global mesh and the dense patches sample
   * the same field), needing no per-zoom handling.
   */
  private warpAmount(x: number, y: number, z: number): number {
    const t =
      INVARIANTS.NEUTRAL_CENTER_POINT +
      0.5 *
        this.noise3D(
          x / CONTINENT.WARP_VAR_WAVELENGTH + WARP_VAR_OFFSET_X,
          y / CONTINENT.WARP_VAR_WAVELENGTH + WARP_VAR_OFFSET_Y,
          z / CONTINENT.WARP_VAR_WAVELENGTH + WARP_VAR_OFFSET_Z
        );
    return lerp(CONTINENT.WARP[0], CONTINENT.WARP[1], clamp(t));
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
