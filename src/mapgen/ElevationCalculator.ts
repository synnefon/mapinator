import type { NoiseFunction3D } from "simplex-noise";
import type { Vec3 } from "../common/3DMath";
import { getElevationBandNameRaw } from "../common/biomes";
import { HILLSHADE, INVARIANTS, type TerrainParams } from "../common/settings";
import { applyContrast, clamp, lerp, smoothstep } from "../common/util";
import { fbm3, ridgedFbm3 } from "./fbm";
import { Tectonics } from "./Tectonics";

/** Relief wavelengths + octave depth for elevationAt, bundled so the call site
 * isn't a long list of interchangeable numbers. */
export type ReliefConfig = {
  coastWavelength: number;
  peakWavelength: number;
  oceanWavelength: number;
  // VESTIGIAL: no relief wave reads this anymore — COAST/OCEAN/MOUNTAIN each use their OWN fixed
  // octave count now, so nothing crawls as you zoom. Still threaded in by the LOD ladder; safe to
  // remove with the rest of the extraOctaves plumbing (worker msg + main.ts LOD specs).
  extraOctaves: number;
};

/** A wave's fbm octave stack — each dial group (OCEAN, COAST, …) carries its own. */
type FbmShape = { OCTAVES: number; GAIN: number; LACUNARITY: number };

// Decorrelation offsets so the warp lookups don't mirror the base field.
const WARP_OFFSET_X = 5.2;
const WARP_OFFSET_Y = 1.7;
const WARP_OFFSET_Z = 9.3;

// Land is capped to this far above the waterline (so the CONTINENT + COAST surface alone stays the
// lowest green band; the MOUNTAIN wave is the only thing that lifts land higher). It can't be zero:
// the colour pipeline runs elevation through ELEVATION_CONTRAST before banding, which pushes a value
// sitting exactly at the waterline below it → rendered as ocean. ~0.02 lands at the contrast pivot.
const LAND_HAIR = 0.02;

// Range-envelope noise (#3 — along-strike variation): a low-frequency wave that swells, pinches,
// and gaps each range along its length so it doesn't read as a uniform arc. Wavelength sets how
// often it pinches; the offset decorrelates it from the other fields.
const RANGE_ENVELOPE_WAVELENGTH = 0.5;
const RANGE_ENVELOPE_OFFSET = 19.7;

/**
 * Continentalness-based elevation (model B), sampled on the unit sphere.
 *  - CONTINENT carrier: a low-frequency, domain-warped 3D wave decides where
 *    continents sit, then a shaping curve maps it to a base height.
 *  - COAST + OCEAN waves: smooth relief blended ocean → shore. MOUNTAIN: ridged
 *    peaks on a broad swell, placed along convergent plate boundaries (see Tectonics).
 * 3D simplex on the sphere is seamless — no tiling, no pole artifacts.
 *
 * Every tuned value comes from the injected `params` snapshot (see settings.ts TerrainParams), not
 * the live global dials — so a generator instance is a pure function of (seed, params) and the
 * interface names its whole dependency. HILLSHADE / INVARIANTS are fixed constants, imported direct.
 */
export class ElevationCalculator {
  private noise3D: NoiseFunction3D;
  private tectonics: Tectonics;
  private readonly params: TerrainParams;
  private coastAmplitude: number;
  private continentWavelength: number;
  private continentAmplitude: number;
  private oceanAmplitude: number;
  // Hillshade light in the local (east, north, up) tangent frame, from the fixed azimuth +
  // altitude. Precomputed here (not per cell) from the params at construction.
  private light: { e: number; n: number; u: number };

  constructor(noise3D: NoiseFunction3D, seed: string, params: TerrainParams) {
    this.noise3D = noise3D;
    this.params = params;
    this.tectonics = new Tectonics(seed, noise3D, params);
    this.coastAmplitude = params.COAST.AMPLITUDE;
    this.continentWavelength = params.CONTINENT.WAVELENGTH;
    this.continentAmplitude = params.CONTINENT.AMPLITUDE;
    this.oceanAmplitude = params.OCEAN.AMPLITUDE;
    const az = (HILLSHADE.AZIMUTH_DEG * Math.PI) / 180;
    const alt = (HILLSHADE.ALTITUDE_DEG * Math.PI) / 180;
    this.light = {
      e: Math.sin(az) * Math.cos(alt),
      n: Math.cos(az) * Math.cos(alt),
      u: Math.sin(alt),
    };
  }

  /** Which tectonic plate a cell belongs to (its nearest plate seed). For the render-time plate
   *  overlay — a pure function of position, independent of any field or dial. */
  public plateAt(site: Vec3): number {
    return this.tectonics.plateAt(site.x, site.y, site.z);
  }

  /** Plate-motion arrows (leading-edge samples) for the "view plates" overlay (see
   *  Tectonics.boundaryArrows). */
  public boundaryArrows(): { positions: Float32Array; directions: Float32Array } {
    return this.tectonics.boundaryArrows();
  }

  /**
   * Top-level elevation in [0,1] at a unit-sphere point: base + relief. `C` is the
   * continentalness at this point; the caller passes it in (see continentalness) so it isn't
   * recomputed here and again for moisture / water-proximity.
   */
  public elevationAt(
    site: Vec3,
    reliefCfg: ReliefConfig,
    C: number
  ): number {
    const { CONTINENT, OCEAN, COAST, TECTONIC } = this.params;
    const { x, y, z } = site;
    const { coastWavelength, peakWavelength, oceanWavelength } = reliefCfg;
    // Shelf ramp: 0 out in open ocean → 1 once fully inland. Sets the base height
    // and blends ocean relief into land relief across the continental shelf.
    const shelf = smoothstep(OCEAN.SHELF[0], OCEAN.SHELF[1], C);
    // Below the shelf, depth tracks the carrier: deepest abyss at C=0 rising to the
    // shelf-edge floor; above it, the shelf-edge floor rises to the inland peak.
    const base =
      C < OCEAN.SHELF[0]
        ? lerp(
          0,
          CONTINENT.BASE_HEIGHT,
          smoothstep(0, OCEAN.SHELF[0], C)
        )
        : CONTINENT.BASE_HEIGHT;
    // Coast → inland ramp: 0 at the shoreline, 1 deep inland. Drives the
    // coast/mountain amplitude blend (coast fades out inland, mountains fade in).
    const inland = smoothstep(OCEAN.SHELF[1], 1, C);

    // TIER 1 — the CONTINENT surface: base height + a gentle OCEAN swell (deep water) or fine
    // COAST jaggedness (near the shore, fading inland). This ALONE decides land vs water; no
    // mountain term touches it, so the MOUNTAIN dials can never move the coastline. The COAST and
    // OCEAN waves use their OWN fixed octave counts (no zoom `extraOctaves`) so this surface — and
    // thus the coastline — is identical at every zoom: zooming in resolves the SAME line with a
    // finer mesh instead of growing new octaves that crawl it around.
    let detail: number;
    if (shelf <= 0) {
      detail = this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, OCEAN);
    } else {
      const coast =
        (1 - inland) *
        this.relief(x, y, z, coastWavelength, this.coastAmplitude, COAST);
      detail =
        shelf >= 1
          ? coast
          : lerp(
            this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, OCEAN),
            coast,
            shelf
          );
    }
    const continent = clamp(base + detail);
    // Ocean: the continent decides outright — mountains never raise islands out of the sea.
    if (continent < OCEAN.SEA_LEVEL) return continent;

    // Cap the LAND base to just above the waterline so the CONTINENT + COAST surface alone stays in
    // the lowest (green) band — ONLY the MOUNTAIN wave lifts land into the brown/grey/white bands
    // (mountains off ⇒ all-green continents). ONE variable, OCEAN.SEA_LEVEL, drives both the
    // coastline (continent vs the waterline, above) and this cap; LAND_HAIR is the small margin the
    // colour pipeline's contrast needs (a value exactly at the waterline would render as ocean).
    const land = Math.min(continent, OCEAN.SEA_LEVEL + LAND_HAIR);

    // TIER 2/3 — MOUNTAINS: a broad swell + ridged peaks (placed along tectonic boundaries) added ON
    // TOP of the land. `landMask` is 0 in ocean → 1 on solid land, so ranges reach FULL height
    // anywhere on land; COAST_BIAS then fades only the DEEP interior (×(1 − BIAS·inland)) so ranges
    // favor coasts while the coastal crest keeps full weight. One-way function of C, 0 in ocean →
    // land/water shape untouched. Clamped to the waterline so mountains ONLY ADD relief — a valley
    // deepens toward the coastline's level but never below it (no mountain-made lakes / sea).
    const landMask = smoothstep(OCEAN.SHELF[0], OCEAN.SHELF[1], C);
    const mountainWeight = landMask * (1 - TECTONIC.COAST_BIAS * inland);
    const mountains =
      mountainWeight * this.mountainRelief(x, y, z, peakWavelength);
    return clamp(Math.max(land + mountains, OCEAN.SEA_LEVEL));
  }

  /**
   * Relief (hillshade) for a cell, in [FLOOR, 1]: a fixed cartographic light over the local
   * slope, baked once per cell so it's a free colour multiply at draw time. The slope is two
   * cheap finite-difference relief samples in the cell's east/north tangent frame — reusing
   * this cell's `C` so only the fast-varying relief is re-sampled (not the warp / continent
   * carrier). `h0` is the already-computed elevation at `site` (don't recompute).
   */
  public hillshadeAt(
    site: Vec3,
    reliefCfg: ReliefConfig,
    C: number,
    h0: number
  ): number {
    const { CONTINENT, OCEAN } = this.params;
    // Relief shading is for MOUNTAINS only — the HIGH + VERY_HIGH elevation families. Map h0
    // through the same contrast + waterline remap the renderer bands on (BiomeColor), then gate
    // on the family: ocean and lower land (LOW/MEDIUM) stay flat-lit (shade 1). This also skips
    // the slope samples for the vast majority of cells.
    // Compare in CONTRASTED space: applyContrast is monotonic, so ec < applyContrast(WATERLINE) ⟺
    // h0 < WATERLINE — the SAME land/ocean split generation made on the raw value. (Thresholding the
    // contrasted ec against the raw WATERLINE only matched while WATERLINE ≈ the 0.5 contrast pivot.)
    const cwl = applyContrast(OCEAN.SEA_LEVEL, CONTINENT.ELEVATION_CONTRAST);
    const ec = applyContrast(h0, CONTINENT.ELEVATION_CONTRAST);
    if (ec < cwl) return 1;
    const landE = Math.min((ec - cwl) / (1 - cwl), 1 - 1e-9);
    const family = getElevationBandNameRaw(landE).colorFamily;
    // TRUE MOUNTAINS only: the HIGH (bare rock) + VERY_HIGH (snow) bands — the height only the
    // MOUNTAIN wave can reach (land base is capped to the green band). Everything below — green
    // foothills/swell (MEDIUM) and flat LOW plains — stays flat-lit, so shadows mark real
    // mountains, not every raised feature.
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
      C
    );
    const hN = this.elevationAt(
      { x: x + nx * e, y: y + ny * e, z: z + nz * e },
      reliefCfg,
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

  /**
   * One relief fBm wave (COAST or OCEAN) at the wave's OWN fixed octave count — deliberately NOT
   * the zoom `extraOctaves`. These two waves sum into `continent`, which decides land vs water, so
   * freezing their octaves keeps the COASTLINE identical at every zoom (a finer mesh just resolves
   * the same line, rather than adding octaves that move it). Want a more detailed coast? Raise
   * COAST.OCTAVES — it applies to the globe and every patch uniformly and stays zoom-stable. Only
   * the additive MOUNTAIN relief (clamped to never cross the waterline) gains octaves on zoom.
   */
  private relief(
    x: number,
    y: number,
    z: number,
    wavelength: number,
    amplitude: number,
    shape: FbmShape
  ): number {
    return fbm3(
      this.noise3D,
      x,
      y,
      z,
      wavelength,
      amplitude,
      shape.OCTAVES,
      shape.GAIN,
      shape.LACUNARITY
    );
  }

  /**
   * Relief for one mountain range: a broad SWELL with sharp ridged PEAKS riding on top. Placement
   * AND the swell both come from the TECTONIC model (`upliftAt`) — high along convergent plate
   * boundaries → ranges are linear CHAINS following the boundary arcs (not isotropic blobs), and
   * taller where plates converge harder. RIDGE_WAVELENGTH sets how many peaks (smaller = more);
   * RIDGE_AMPLITUDE is the overall height (collision swell + crests). uplift's band tapers it to foothills.
   */
  private mountainRelief(
    x: number,
    y: number,
    z: number,
    peakWavelength: number
  ): number {
    const { MOUNTAIN, TECTONIC, features } = this.params;
    if (!features.mountains) return 0; // mountains layer off → no relief term (CONTINENT shape untouched)
    const uplift = this.tectonics.upliftAt(x, y, z);
    if (uplift <= 0) return 0; // off every boundary → flat plain (skip the ridged sample)
    // Sharp ridged crests in [0, RIDGE_AMPLITUDE]: near 0 in the valleys between peaks, near
    // RIDGE_AMPLITUDE on the ridgelines. RIDGE_WAVELENGTH sets how closely packed the peaks are.
    const peaks = ridgedFbm3(
      this.noise3D,
      x,
      y,
      z,
      peakWavelength,
      MOUNTAIN.RIDGE_AMPLITUDE,
      MOUNTAIN.OCTAVES, // fixed (NOT + extraOctaves) so ridge detail doesn't crawl as you zoom — like COAST/OCEAN/MOISTURE
      MOUNTAIN.GAIN,
      MOUNTAIN.LACUNARITY
    );
    // Along-strike VARIATION (#3): a low-freq noise that swells, pinches, and gaps the range along
    // its length so it isn't a uniform arc. 0 = uniform; 1 = down to full gaps.
    const v =
      0.5 +
      0.5 *
        this.noise3D(
          x / RANGE_ENVELOPE_WAVELENGTH + RANGE_ENVELOPE_OFFSET,
          y / RANGE_ENVELOPE_WAVELENGTH + RANGE_ENVELOPE_OFFSET,
          z / RANGE_ENVELOPE_WAVELENGTH + RANGE_ENVELOPE_OFFSET
        );
    const envelope = 1 - TECTONIC.VARIATION * (1 - v);
    // The broad SWELL is the collision itself: `uplift` (convergence × band) lifts a body sized to
    // SWELL_FRACTION of RIDGE_AMPLITUDE, with the ridged crests rising on top. uplift + envelope
    // scale both, so a range tapers to foothills at its rim and pinches / gaps along its length.
    return uplift * envelope * (MOUNTAIN.RIDGE_AMPLITUDE * MOUNTAIN.SWELL_FRACTION + peaks);
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
    const { CONTINENT } = this.params;
    const warp = CONTINENT.WARP;
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
        this.continentAmplitude, CONTINENT.OCTAVES, CONTINENT.GAIN, CONTINENT.LACUNARITY
      );
    // Same warp + wavelength, fewer octaves → a low-pass of `full` (the big structures only).
    const broad =
      base +
      fbm3(
        this.noise3D, wx, wy, wz, this.continentWavelength,
        this.continentAmplitude, broadOctaves, CONTINENT.GAIN, CONTINENT.LACUNARITY
      );
    return { full: clamp(full), broad: clamp(broad) };
  }

  /** Raw carrier-scale noise (lower frequency than the relief waves). */
  private continentNoise(x: number, y: number, z: number): number {
    return this.noise3D(
      x / this.continentWavelength,
      y / this.continentWavelength,
      z / this.continentWavelength
    );
  }
}
