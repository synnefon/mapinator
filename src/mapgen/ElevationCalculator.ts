import type { NoiseFunction3D } from "simplex-noise";
import type { Vec3 } from "../common/3DMath";
import { SHADE_MIN_LAND_E } from "../common/elevationBands";
import { INVARIANTS, type TerrainParams } from "../common/settings";
import { applyContrast, clamp, lerp, smoothstep } from "../common/util";
import { classifyKoppen, hadleyPrecipFactor, meanAnnualTempC, moistureToPrecipMm, seasonalAmplitudeC } from "../common/koppen";
import { fbm3, ridgedFbm3 } from "./fbm";
import {
  CONTINENT_WARP_OFFSET_X as WARP_OFFSET_X,
  CONTINENT_WARP_OFFSET_Y as WARP_OFFSET_Y,
  CONTINENT_WARP_OFFSET_Z as WARP_OFFSET_Z,
  ICE_HOLE_FREQ,
  ICE_HOLE_SOFTNESS,
  ICE_RUFFLE_FREQ,
  ICE_RUFFLE_OFFSET,
  LAND_HAIR,
  MOISTURE_NOISE_OFFSET,
  RANGE_ENVELOPE_OFFSET,
  RANGE_ENVELOPE_WAVELENGTH,
} from "./fieldConstants";
import { Tectonics } from "./Tectonics";

/** A wave's fbm octave stack — each dial group (OCEAN, COAST, …) carries its own. */
type FbmShape = { OCTAVES: number; GAIN: number; LACUNARITY: number };

// The fixed (non-dial) field constants used below — the continent warp offsets, the LAND_HAIR cap, the
// mountain range envelope, and the moisture / ice-cap noise — are shared with the GPU shader and live in
// fieldConstants.ts (imported above; WARP_OFFSET_* alias the continent set). See there for the rationale.

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
 * interface names its whole dependency. INVARIANTS is a fixed constant, imported direct.
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
    this.coastAmplitude = params.COASTS.AMPLITUDE;
    this.continentWavelength = params.CONTINENTS.WAVELENGTH;
    this.continentAmplitude = params.CONTINENTS.AMPLITUDE;
    this.oceanAmplitude = params.OCEANS.AMPLITUDE;
    const az = (params.HILLSHADE.AZIMUTH_DEG * Math.PI) / 180;
    const alt = (params.HILLSHADE.ALTITUDE_DEG * Math.PI) / 180;
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

  /** Plate-motion arrows (leading-edge samples) for the "tectonic plates" overlay (see
   *  Tectonics.boundaryArrows). */
  public boundaryArrows(): { positions: Float32Array; directions: Float32Array } {
    return this.tectonics.boundaryArrows();
  }

  /**
   * Top-level elevation in [0,1] at a unit-sphere point: base + relief. `C` is the
   * continentalness at this point; the caller passes it in (see continentalness) so it isn't
   * recomputed here and again for moisture / water-proximity. `upliftOverride` (optional) supplies
   * the tectonic uplift already computed at `site` so the per-cell sampler doesn't re-derive it;
   * omit it elsewhere (the hillshade slope samples at offset points compute their own).
   */
  public elevationAt(site: Vec3, C: number, upliftOverride?: number): { elevation: number; reportElevation: number } {
    const { CONTINENTS, OCEANS, COASTS, TECTONICS, LAND_RELIEF } = this.params;
    const { x, y, z } = site;
    const coastWavelength = COASTS.WAVELENGTH;
    const oceanWavelength = OCEANS.WAVELENGTH;
    // Shelf ramp: 0 out in open ocean → 1 once fully inland. Sets the base height
    // and blends ocean relief into land relief across the continental shelf.
    const shelf = smoothstep(OCEANS.SHELF[0], OCEANS.SHELF[1], C);
    // Below the shelf, depth tracks the carrier: deepest abyss at C=0 rising to the
    // shelf-edge floor; above it, the shelf-edge floor rises to the inland peak.
    const base =
      C < OCEANS.SHELF[0]
        ? lerp(
          0,
          CONTINENTS.BASE_HEIGHT,
          smoothstep(0, OCEANS.SHELF[0], C)
        )
        : CONTINENTS.BASE_HEIGHT;
    // Coast → inland ramp: 0 at the shoreline, 1 deep inland. Drives the
    // coast/mountain amplitude blend (coast fades out inland, mountains fade in).
    const inland = smoothstep(OCEANS.SHELF[1], 1, C);

    // TIER 1 — the CONTINENT surface: base height + a gentle OCEAN swell (deep water) or fine
    // COAST jaggedness (near the shore, fading inland). This ALONE decides land vs water; no
    // mountain term touches it, so the MOUNTAIN dials can never move the coastline. The COAST and
    // OCEAN waves use their OWN fixed octave counts (never zoom-varying) so this surface — and
    // thus the coastline — is identical at every zoom: zooming in resolves the SAME line with a
    // finer mesh instead of growing new octaves that crawl it around.
    let detail: number;
    if (shelf <= 0) {
      detail = this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, OCEANS);
    } else {
      const coast =
        (1 - inland) *
        this.relief(x, y, z, coastWavelength, this.coastAmplitude, COASTS);
      detail =
        shelf >= 1
          ? coast
          : lerp(
            this.relief(x, y, z, oceanWavelength, this.oceanAmplitude, OCEANS),
            coast,
            shelf
          );
    }
    const continent = clamp(base + detail);
    // Ocean: the continent decides outright — mountains never raise islands out of the sea.
    if (continent < OCEANS.SEA_LEVEL) return { elevation: continent, reportElevation: continent };

    // Cap the LAND base to just above the waterline so the CONTINENT + COAST surface alone stays in
    // the lowest (green) band — ONLY the MOUNTAIN wave lifts land into the brown/grey/white bands
    // (mountains off ⇒ all-green continents). ONE variable, OCEANS.SEA_LEVEL, drives both the
    // coastline (continent vs the waterline, above) and this cap; LAND_HAIR is the small margin the
    // colour pipeline's contrast needs (a value exactly at the waterline would render as ocean).
    const land = Math.min(continent, OCEANS.SEA_LEVEL + LAND_HAIR);

    // TIER 2/3 — MOUNTAINS: a broad swell + ridged peaks (placed along tectonic boundaries) added ON
    // TOP of the land. `landMask` is 0 in ocean → 1 on solid land, so ranges reach FULL height
    // anywhere on land; COAST_BIAS then fades only the DEEP interior (×(1 − BIAS·inland)) so ranges
    // favor coasts while the coastal crest keeps full weight. One-way function of C, 0 in ocean →
    // land/water shape untouched. Clamped to the waterline so mountains ONLY ADD relief — a valley
    // deepens toward the coastline's level but never below it (no mountain-made lakes / sea).
    const landMask = smoothstep(OCEANS.SHELF[0], OCEANS.SHELF[1], C);
    // Gentle continental uplands (LAND_RELIEF) ride on the flat land base, gated to land and rectified
    // positive so they only lift plains into plateaus — never dip below the waterline (coastline stays put).
    const landRelief =
      landMask * Math.max(0, this.relief(x, y, z, LAND_RELIEF.WAVELENGTH, LAND_RELIEF.AMPLITUDE, LAND_RELIEF));
    const mountainWeight = landMask * (1 - TECTONICS.COAST_BIAS * inland);
    const mountains = mountainWeight * this.mountainRelief(x, y, z, upliftOverride);
    const rendered = clamp(Math.max(land + landRelief + mountains, OCEANS.SEA_LEVEL));
    // REPORT ignores the rendering cap — but NOT by restoring `continent`, which carries the big
    // COAST/OCEAN detail wave (that's horizontal coastline SHAPE, not altitude; the cap exists to flatten
    // it off the land). The cap merely pins every non-mountain land cell at LAND_HAIR above the waterline;
    // report strips that pedestal back off, so flat land — the ENTIRE coast included — reads sea level
    // (0 m) and only genuine MOUNTAIN relief rises above it. Used by display / stats / population.
    const reportElevation = clamp(OCEANS.SEA_LEVEL + Math.max(0, rendered - (OCEANS.SEA_LEVEL + LAND_HAIR)));
    return { elevation: rendered, reportElevation };
  }

  /**
   * Relief (hillshade) for a cell, in [FLOOR, 1]: a fixed cartographic light over the local
   * slope, baked once per cell so it's a free colour multiply at draw time. The slope is two
   * cheap finite-difference relief samples in the cell's east/north tangent frame — reusing
   * this cell's `C` so only the fast-varying relief is re-sampled (not the warp / continent
   * carrier). `h0` is the already-computed elevation at `site` (don't recompute).
   */
  public hillshadeAt(site: Vec3, C: number, h0: number): number {
    const { CONTINENTS, OCEANS } = this.params;
    // Relief shading over ALL land, with AERIAL PERSPECTIVE: the shadow floor ramps from shallow
    // (LOWLAND_FLOOR — gentle form on the plains) to deep (FLOOR — dramatic mountains) by the
    // MEDIUM→HIGH boundary (SHADE_MIN_LAND_E). Map h0 through the same contrast + waterline remap the
    // renderer bands on (BiomeColor) so this land/ocean split matches the one generation made.
    // Compare in CONTRASTED space: applyContrast is monotonic, so ec < applyContrast(WATERLINE) ⟺
    // h0 < WATERLINE — the SAME land/ocean split generation made on the raw value. (Thresholding the
    // contrasted ec against the raw WATERLINE only matched while WATERLINE ≈ the 0.5 contrast pivot.)
    const cwl = applyContrast(OCEANS.SEA_LEVEL, CONTINENTS.ELEVATION_CONTRAST);
    const ec = applyContrast(h0, CONTINENTS.ELEVATION_CONTRAST);
    if (ec < cwl) return 1; // ocean: flat-lit
    const landE = Math.min((ec - cwl) / (1 - cwl), 1 - 1e-9);
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

    const e = this.params.HILLSHADE.EPSILON;
    const hE = this.elevationAt({ x: x + ex * e, y: y + ey * e, z: z + ez * e }, C).elevation;
    const hN = this.elevationAt({ x: x + nx * e, y: y + ny * e, z: z + nz * e }, C).elevation;

    // Surface normal in (east, north, up): the up vector tilted opposite the uphill slope,
    // exaggerated. Dot with the fixed light; FLOOR lifts shadows off pure black.
    const k = this.params.HILLSHADE.EXAGGERATION;
    const nE = -k * (hE - h0);
    const nN = -k * (hN - h0);
    const len = Math.hypot(nE, nN, 1);
    const dot = (nE * this.light.e + nN * this.light.n + this.light.u) / len;
    // Aerial perspective: floor ramps from shallow (plains) to deep (mountains) by SHADE_MIN_LAND_E.
    const floorE = lerp(
      this.params.HILLSHADE.LOWLAND_FLOOR,
      this.params.HILLSHADE.FLOOR,
      smoothstep(0, SHADE_MIN_LAND_E, landE)
    );
    return lerp(floorE, 1, clamp(dot));
  }

  /**
   * One relief fBm wave (COAST or OCEAN) at the wave's OWN fixed octave count — never zoom-varying.
   * These two waves sum into `continent`, which decides land vs water, so freezing their octaves
   * keeps the COASTLINE identical at every zoom (a finer mesh just resolves the same line, rather
   * than adding octaves that move it). Want a more detailed coast? Raise COASTS.OCTAVES — it applies
   * to the globe and every patch uniformly. Every wave (COAST/OCEAN/MOUNTAIN/MOISTURE) now uses a
   * fixed octave count, so nothing crawls as you zoom.
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
  private mountainRelief(x: number, y: number, z: number, upliftOverride?: number): number {
    const { MOUNTAINS, TECTONICS, features } = this.params;
    if (!features.mountains) return 0; // mountains layer off → no relief term (CONTINENT shape untouched)
    // Reuse the uplift the per-cell sampler already computed (alongside the plate); only the offset
    // slope samples in hillshadeAt pass nothing and re-derive it. `??` (not `||`) so a real 0 stands.
    const uplift = upliftOverride ?? this.tectonics.upliftAt(x, y, z);
    if (uplift <= 0) return 0; // off every boundary → flat plain (skip the ridged sample)
    // Sharp ridged crests in [0, RIDGE_AMPLITUDE]: near 0 in the valleys between peaks, near
    // RIDGE_AMPLITUDE on the ridgelines. RIDGE_WAVELENGTH sets how closely packed the peaks are.
    const peaks = ridgedFbm3(
      this.noise3D,
      x,
      y,
      z,
      MOUNTAINS.RIDGE_WAVELENGTH,
      MOUNTAINS.RIDGE_AMPLITUDE,
      MOUNTAINS.OCTAVES, // fixed octave count (never zoom-varying) so ridge detail doesn't crawl — like COAST/OCEAN/MOISTURE
      MOUNTAINS.GAIN,
      MOUNTAINS.LACUNARITY
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
    const envelope = 1 - TECTONICS.VARIATION * (1 - v);
    // The broad SWELL is the collision itself: `uplift` (convergence × band) lifts a body sized to
    // SWELL_FRACTION of RIDGE_AMPLITUDE, with the ridged crests rising on top. uplift + envelope
    // scale both, so a range tapers to foothills at its rim and pinches / gaps along its length.
    return uplift * envelope * (MOUNTAINS.RIDGE_AMPLITUDE * MOUNTAINS.SWELL_FRACTION + peaks);
  }

  public continentalness(
    x: number,
    y: number,
    z: number,
    broadOctaves: number
  ): { full: number; broad: number } {
    const { CONTINENTS } = this.params;
    const warp = CONTINENTS.WARP;
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
        this.continentAmplitude, CONTINENTS.OCTAVES, CONTINENTS.GAIN, CONTINENTS.LACUNARITY
      );
    // Same warp + wavelength, fewer octaves → a low-pass of `full` (the big structures only).
    const broad =
      base +
      fbm3(
        this.noise3D, wx, wy, wz, this.continentWavelength,
        this.continentAmplitude, broadOctaves, CONTINENTS.GAIN, CONTINENTS.LACUNARITY
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

  /**
   * The full per-cell field pipeline in ONE place: sample the shared continentalness once (expensive
   * noise lookups, reused across fields), then derive elevation, hillshade, moisture, ice, and the
   * tectonic plate from it. `continentalnessOverride` (the /sweep flat-base hook) forces
   * continentalness to a constant so the base is a flat plain and ONLY MOUNTAIN/TECTONIC vary;
   * undefined = normal terrain. MapGenerator just meshes + packs the result.
   */
  public sampleCell(
    site: Vec3,
    continentalnessOverride?: number
  ): { elevation: number; reportElevation: number; moisture: number; ice: number; shade: number; plate: number; koppenZone: number } {
    const { ICE, MOISTURE } = this.params;
    // continentalness drives both the land/ocean elevation and the moisture maritime layer
    // (`broad` = the low-octave low-pass that sizes the maritime reach to the water body).
    const { full: continentalness, broad: broadContinentalness } =
      continentalnessOverride !== undefined
        ? { full: continentalnessOverride, broad: continentalnessOverride }
        : this.continentalness(site.x, site.y, site.z, MOISTURE.WATER_SIZE_OCTAVES);
    // Uplift (mountain weight) + owning plate share ONE warp + nearest-plate scan (see
    // Tectonics.upliftAndPlateAt); pass uplift into elevationAt so it isn't re-sampled. Drops a
    // redundant warp + scan per land cell; bit-identical to the old separate upliftAt + plateAt.
    const { uplift, plate } = this.tectonics.upliftAndPlateAt(site.x, site.y, site.z);
    // Rendered (capped → flat green band) + report (uncapped real height, ~0 at the coast). See elevationAt.
    const { elevation, reportElevation } = this.elevationAt(site, continentalness, uplift);
    // Relief shading from the SAME field — reuses continentalness, only re-samples the relief twice
    // (for the slope). Baked per cell → a free colour multiply at draw time.
    const shade = this.hillshadeAt(site, continentalness, elevation);
    const moisture = this.moistureAt(site, continentalness, broadContinentalness);
    const ice = this.iceAt(site, elevation, clamp(ICE.COVERAGE));
    // Köppen biome zone — the SINGLE source for biome colour + labels. Mirrors koppen.glsl.ts:koppenZone
    // (uses the same post-maritime moisture + the shared continentalness as the field shader).
    const koppenZone = this.koppenZoneAt(site, elevation, moisture, continentalness);
    return { elevation, reportElevation, moisture, ice, shade, plate, koppenZone };
  }

  /**
   * Moisture in [0,1] at a sphere point; contrast baked in (it's a fixed dial). Like the COAST /
   * OCEAN waves, this wave uses its OWN fixed octave count — never zoom octaves — so the biome
   * boundaries it decides don't crawl as you zoom (a finer mesh resolves the SAME boundaries).
   * Maritime humidity pulls moisture toward wet near water (min(full, broad) so a big ocean reaches
   * far inland while an oasis only dents the local field).
   */
  private moistureAt(
    site: Vec3,
    continentalness: number,
    broadContinentalness: number
  ): number {
    const { MOISTURE, OCEANS, features } = this.params;
    if (!features.climate) return INVARIANTS.NEUTRAL_CENTER_POINT; // climate off → flat moisture everywhere
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE_NOISE_OFFSET,
      site.y + MOISTURE_NOISE_OFFSET,
      site.z + MOISTURE_NOISE_OFFSET,
      MOISTURE.WAVELENGTH,
      MOISTURE.AMPLITUDE,
      MOISTURE.OCTAVES, // fixed octave count (never zoom-varying) so biome boundaries don't crawl as you zoom
      MOISTURE.GAIN,
      MOISTURE.LACUNARITY
    );
    let m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw);
    const oceanic = Math.min(continentalness, broadContinentalness);
    const waterProximity = Math.pow(1 - oceanic, MOISTURE.DESERT_STEEPNESS);
    m = lerp(m, 1, MOISTURE.WATER_PROXIMITY_EFFECT * waterProximity);
    // Interior dryness — the inverse of maritime humidity: deep continental interiors lose moisture, placing
    // the Gobi / Sahara-heart / Great-Basin drylands far from any coast. inland = 0 at the shelf → 1 deep inland.
    const inland = smoothstep(OCEANS.SHELF[1], 1, continentalness);
    m = lerp(m, 0, MOISTURE.INTERIOR_DRYNESS * inland);
    return applyContrast(m, MOISTURE.CONTRAST);
  }

  /**
   * The cell's Köppen zone index (KZ.*) — the GPU twin is koppen.glsl.ts:koppenZone, kept in sync. Climate
   * inputs (latitude → mean temp, a synthesized seasonal swing from latitude + continentality, precipitation
   * from moisture) are mottled by a multi-octave JITTER, then classified into a Köppen zone.
   */
  private koppenZoneAt(site: Vec3, elevation: number, moisture: number, continentalness: number): number {
    const { CLIMATE, OCEANS } = this.params;
    const seaLevel = OCEANS.SEA_LEVEL;
    const latDeg = (Math.asin(Math.max(-1, Math.min(1, site.y))) * 180) / Math.PI;
    const absLat = Math.abs(latDeg);
    const jT = CLIMATE.JITTER * 8 * fbm3(this.noise3D, site.x + 11.3, site.y + 4.7, site.z + 19.1, CLIMATE.JITTER_SCALE, 1, 5, 0.5, 2);
    const jM = CLIMATE.JITTER * 0.18 * fbm3(this.noise3D, site.x + 31.7, site.y + 23.9, site.z + 7.5, CLIMATE.JITTER_SCALE, 1, 5, 0.5, 2);
    const matC = meanAnnualTempC(latDeg, elevation, seaLevel) + jT;
    const moist = clamp(moisture + jM);
    const continentality = smoothstep(OCEANS.SHELF[1], 1, continentalness);
    const amp = seasonalAmplitudeC(absLat / 90, continentality, CLIMATE.SEASONALITY, CLIMATE.CONTINENTAL_SEASONALITY);
    const precip = moistureToPrecipMm(moist) * hadleyPrecipFactor(absLat, CLIMATE.HADLEY);
    return classifyKoppen(matC, matC + amp, matC - amp, precip, absLat, moist, elevation, seaLevel, continentality);
  }

  /**
   * Polar iciness in [0,1] — LAND ONLY (open water never ices). A cap poleward of a COVERAGE snow
   * line, wobbled (WOBBLE) so it isn't a clean circle, fading into land over BLEND, with low-lying
   * land poking through as holes below a FILL-controlled threshold (higher FILL → fewer holes).
   */
  private iceAt(site: Vec3, elevation: number, coverage: number): number {
    const { ICE, OCEANS, features } = this.params;
    if (!features.ice) return 0; // ice layer off → no polar caps anywhere
    // Snow line in |sin lat|: COVERAGE is the fraction of each hemisphere the cap reaches (line at
    // 1 − COVERAGE; higher COVERAGE → line nearer the equator → bigger caps).
    const line = 1 - coverage;
    const f = ICE_RUFFLE_FREQ;
    const o = ICE_RUFFLE_OFFSET;
    const wobble =
      ICE.WOBBLE *
      (this.noise3D(site.x * f + o, site.y * f + o, site.z * f + o) +
        0.5 *
        this.noise3D(site.x * f * 3 + o, site.y * f * 3 + o, site.z * f * 3 + o));
    const inCap = smoothstep(line - ICE.BLEND, line, Math.abs(site.y) + wobble);
    if (inCap <= 0) return 0;
    // LAND ONLY — ocean sits below the waterline, so it never ices.
    if (elevation < OCEANS.SEA_LEVEL) return 0;
    // FILL → holes from a fixed-wavelength noise (independent of mountains, stable across zoom).
    const h =
      0.5 +
      0.5 *
        this.noise3D(
          site.x * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET,
          site.y * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET,
          site.z * ICE_HOLE_FREQ + ICE_RUFFLE_OFFSET
        );
    const solid = smoothstep(1 - ICE.FILL, 1 - ICE.FILL + ICE_HOLE_SOFTNESS, h);
    return inCap * solid;
  }
}
