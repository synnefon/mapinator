import type { NoiseFunction3D } from "simplex-noise";
import type { Vec3 } from "../common/3DMath";
import { getElevationBandNameRaw } from "../common/biomes";
import { type RNG } from "../common/random";
import {
  COAST,
  CONTINENT,
  FEATURE_DETAIL,
  FRACTAL,
  HILLSHADE,
  INVARIANTS,
  MOUNTAIN,
  MOUNTAIN_RANGE,
  OCEAN,
  sampleDial,
} from "../common/settings";
import { applyContrast, clamp, lerp, smoothstep } from "../common/util";
import { fbm3, ridgedFbm3 } from "./fbm";

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
const MTN_REGION_OFFSET_X = 41.2;
const MTN_REGION_OFFSET_Y = 13.8;
const MTN_REGION_OFFSET_Z = 29.5;

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
  // Hillshade light in the local (east, north, up) tangent frame, from the fixed azimuth +
  // altitude. Precomputed here (not per cell); re-derived on reSeed if the dials are tuned.
  private light: { e: number; n: number; u: number };

  constructor(rng: RNG, noise3D: NoiseFunction3D) {
    this.noise3D = noise3D;
    this.coastAmplitude = sampleDial(COAST.AMPLITUDE, rng);
    // this.mountainAmplitude = sampleDial(MOUNTAIN.AMPLITUDE, rng);
    this.mountainAmplitude = MOUNTAIN.AMPLITUDE;
    this.continentWavelength = sampleDial(CONTINENT.WAVELENGTH, rng);
    this.continentAmplitude = sampleDial(CONTINENT.AMPLITUDE, rng);
    this.erosionWavelength = sampleDial(FEATURE_DETAIL.WAVELENGTH, rng);
    this.oceanAmplitude = sampleDial(OCEAN.AMPLITUDE, rng);
    const az = (HILLSHADE.AZIMUTH_DEG * Math.PI) / 180;
    const alt = (HILLSHADE.ALTITUDE_DEG * Math.PI) / 180;
    this.light = {
      e: Math.sin(az) * Math.cos(alt),
      n: Math.cos(az) * Math.cos(alt),
      u: Math.sin(alt),
    };
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
    const shelf = smoothstep(OCEAN.SHELF[0], OCEAN.SHELF[1], C);
    // Below the shelf, depth tracks the carrier: deepest abyss at C=0 rising to the
    // shelf-edge floor; above it, the shelf-edge floor rises to the inland peak.
    const base =
      C < OCEAN.SHELF[0]
        ? lerp(
          OCEAN.ABYSS_HEIGHT,
          CONTINENT.BASE_HEIGHT[0],
          smoothstep(0, OCEAN.SHELF[0], C)
        )
        : lerp(CONTINENT.BASE_HEIGHT[0], CONTINENT.BASE_HEIGHT[1], shelf);
    // Coast → inland ramp: 0 at the shoreline, 1 deep inland. Drives both the
    // coast/mountain amplitude blend and the downward sink-damp.
    const inland = smoothstep(OCEAN.SHELF[1], 1, C);

    // TIER 1 — the CONTINENT surface: base height + a gentle OCEAN swell (deep water) or fine
    // COAST jaggedness (near the shore, fading inland). This ALONE decides land vs water; no
    // mountain term touches it, so the MOUNTAIN dials can never move the coastline.
    let detail: number;
    if (shelf <= 0) {
      detail = this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, extraOctaves);
    } else {
      const coast =
        (1 - inland) *
        this.relief(x, y, z, coastWavelength, this.coastAmplitude, extraOctaves);
      detail =
        shelf >= 1
          ? coast
          : lerp(
            this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, extraOctaves),
            coast,
            shelf
          );
    }
    const continent = clamp(base + erosion * detail);
    // Ocean: the continent decides outright — mountains never raise islands out of the sea.
    if (continent < COAST.WATERLINE) return continent;

    // TIER 2/3 — MOUNTAINS: ridged relief (placed by the region mask) scaled by continentalness
    // (`inland` = the continent→mountain influence) and added ON TOP of the land. Clamped to the
    // waterline so they ONLY ADD relief — a valley can deepen toward the coastline's level but
    // never below it (no mountain-made lakes / sea). At MOUNTAIN amplitude 0 this term is 0 and
    // the continent is untouched: the dials modify the existing land (none → a lot), never reshape it.
    const mountains =
      inland * erosion * this.mountainRelief(x, y, z, mountainWavelength, extraOctaves);
    return clamp(Math.max(continent + mountains, COAST.WATERLINE));
  }

  /**
   * Relief (hillshade) for a cell, in [FLOOR, 1]: a fixed cartographic light over the local
   * slope, baked once per cell so it's a free colour multiply at draw time. The slope is two
   * cheap finite-difference relief samples in the cell's east/north tangent frame — reusing
   * this cell's `erosion` + `C` so only the fast-varying relief is re-sampled (not the warp /
   * continent carrier). `h0` is the already-computed elevation at `site` (don't recompute).
   */
  public hillshadeAt(
    site: Vec3,
    reliefCfg: ReliefConfig,
    erosion: number,
    C: number,
    h0: number
  ): number {
    // Relief shading is for MOUNTAINS only — the HIGH + VERY_HIGH elevation families. Map h0
    // through the same contrast + waterline remap the renderer bands on (BiomeColor), then gate
    // on the family: ocean and lower land (LOW/MEDIUM) stay flat-lit (shade 1). This also skips
    // the slope samples for the vast majority of cells.
    const ec = applyContrast(h0, CONTINENT.ELEVATION_CONTRAST);
    if (ec < COAST.WATERLINE) return 1;
    const landE = Math.min((ec - COAST.WATERLINE) / (1 - COAST.WATERLINE), 1 - 1e-9);
    const family = getElevationBandNameRaw(landE).colorFamily;
    if (family !== "HIGH" && family !== "VERY_HIGH") return 1;
    const { x, y, z } = site;
    // North tangent = world +Y projected onto the tangent plane; at the poles (+Y has no
    // tangential part) fall back to +X. East = site × north (unit, since both are unit & ⊥).
    let nx = -y * x;
    let ny = 1 - y * y;
    let nz = -y * z;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) {
      nx = 1 - x * x;
      ny = -x * y;
      nz = -x * z;
      nl = Math.hypot(nx, ny, nz);
    }
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const ex = y * nz - z * ny;
    const ey = z * nx - x * nz;
    const ez = x * ny - y * nx;

    const e = HILLSHADE.EPSILON;
    const hE = this.elevationAt(
      { x: x + ex * e, y: y + ey * e, z: z + ez * e },
      reliefCfg,
      erosion,
      C
    );
    const hN = this.elevationAt(
      { x: x + nx * e, y: y + ny * e, z: z + nz * e },
      reliefCfg,
      erosion,
      C
    );

    // Surface normal in (east, north, up): the up vector tilted opposite the uphill slope,
    // exaggerated. Dot with the fixed light; FLOOR lifts shadows off pure black.
    const k = HILLSHADE.EXAGGERATION;
    const nE = -k * (hE - h0);
    const nN = -k * (hN - h0);
    const len = Math.hypot(nE, nN, 1);
    const dot = (nE * this.light.e + nN * this.light.n + this.light.u) / len;
    return lerp(HILLSHADE.FLOOR, 1, clamp(dot));
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

  /** Ridged-multifractal relief for the inland MOUNTAIN wave: sharp branched ridgelines that
   * rise from the base into the snow band, instead of the smooth fBm lumps used for coast /
   * ocean. In [0, amplitude] (ridges up; valleys sit near the inland base height). */
  private mountainRelief(
    x: number,
    y: number,
    z: number,
    wavelength: number,
    extraOctaves: number
  ): number {
    // FINE ridge wave, centered: subtract a fraction of the amplitude so ridges carve DOWN into
    // valleys as well as up into crests — green valleys between rock/snow crests.
    const ridges =
      ridgedFbm3(
        this.noise3D,
        x,
        y,
        z,
        wavelength,
        this.mountainAmplitude,
        FRACTAL.OCTAVES + extraOctaves,
        FRACTAL.GAIN,
        FRACTAL.LACUNARITY
      ) -
      this.mountainAmplitude * MOUNTAIN.VALLEY_BIAS;
    // Gated by the COARSE region mask so the ridges form distinct massifs separated by flat
    // (green) plains, rather than covering all inland. mask 0 → relief vanishes → base plain.
    return ridges * this.mountainMask(x, y, z);
  }

  /**
   * Coarse low-frequency mask in [0,1] marking WHERE mountain ranges are — the SECOND, much
   * larger wavelength: a low-octave wave thresholded into distinct massifs separated by plains.
   * Decorrelated (offsets) so ranges don't mirror the ridge / warp fields. Region-scale only, so
   * it's deliberately NOT zoom-dependent (the same ranges at every LOD).
   */
  private mountainMask(x: number, y: number, z: number): number {
    const m =
      INVARIANTS.NEUTRAL_CENTER_POINT +
      fbm3(
        this.noise3D,
        x + MTN_REGION_OFFSET_X,
        y + MTN_REGION_OFFSET_Y,
        z + MTN_REGION_OFFSET_Z,
        MOUNTAIN_RANGE.WAVELENGTH,
        MOUNTAIN_RANGE.AMPLITUDE,
        MOUNTAIN_RANGE.OCTAVES,
        FRACTAL.GAIN,
        FRACTAL.LACUNARITY
      );
    return clamp(m) > MOUNTAIN_RANGE.THRESHOLD ? 1 : 0;
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
   * (CONTINENT.WARP_WAVELENGTH) between CONTINENT.WARP's min/max — so some regions
   * get wandering, organic coasts and others smoother ones. It's a function of position,
   * so it's identical at every zoom level (the global mesh and the dense patches sample
   * the same field), needing no per-zoom handling.
   */
  private warpAmount(x: number, y: number, z: number): number {
    const t =
      INVARIANTS.NEUTRAL_CENTER_POINT +
      0.5 *
      this.noise3D(
        x / CONTINENT.WARP_WAVELENGTH + WARP_VAR_OFFSET_X,
        y / CONTINENT.WARP_WAVELENGTH + WARP_VAR_OFFSET_Y,
        z / CONTINENT.WARP_WAVELENGTH + WARP_VAR_OFFSET_Z
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
