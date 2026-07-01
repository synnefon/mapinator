import { SHADE_MIN_LAND_E } from "../../common/elevationBands";
import { INVARIANTS, type TerrainParams } from "../../common/settings";
import {
  CONTINENT_WARP_OFFSET_X,
  CONTINENT_WARP_OFFSET_Y,
  CONTINENT_WARP_OFFSET_Z,
  CONVERGENCE_SOFTNESS,
  JUNCTION_FADE_WIDTH,
  LAND_HAIR,
  MIN_OCTAVE_AMPLITUDE,
  MOISTURE_NOISE_OFFSET,
  RANGE_ENVELOPE_OFFSET,
  RANGE_ENVELOPE_WAVELENGTH,
  REPORT_INLAND_RISE,
  RIDGE_FEEDBACK,
  RIDGE_SHARPNESS,
  RIVER_ROUGH_GAIN,
  RIVER_ROUGH_LACUNARITY,
  RIVER_ROUGH_OCTAVES,
  RIVER_ROUGH_WAVELENGTH,
  TECTONIC_WARP_OFFSET_X,
  TECTONIC_WARP_OFFSET_Y,
  TECTONIC_WARP_OFFSET_Z,
  TECTONIC_WARP_WAVELENGTH,
} from "../fieldConstants";
import { EXACT_SNOISE_GLSL } from "./exactSnoise.glsl";
import { glslConstBlock, glslFloat } from "./glslConst";
import { KOPPEN_GLSL } from "./koppen.glsl";

/**
 * GLSL port of the FULL per-cell field — the GPU twin of ElevationCalculator.sampleCell. Each block
 * mirrors its CPU source line-for-line so divergences are easy to spot:
 *   - fbm3 / ridgedFbm3 ← fbm.ts
 *   - continentalness   ← ElevationCalculator.continentalness (full + the moisture 'broad' low-pass)
 *   - uplift            ← Tectonics.upliftAndPlateAt (warp + nearest-3 plate scan + convergence/junction)
 *   - mountainRelief    ← ElevationCalculator.mountainRelief (ridged peaks on the collision swell)
 *   - elevationAt       ← ElevationCalculator.elevationAt (base CONTINENT surface + the MOUNTAIN term)
 *   - moistureAt/iceAt/hillshadeAt ← the matching ElevationCalculator methods
 *
 * The noise (exactSnoise.glsl.ts) reproduces the CPU's simplex-noise for the SAME seed (its permutation
 * table is uploaded in `uPerm`), and the plate seeds/poles match Tectonics (uploaded in `uPlateTex`), so
 * a GPU patch reproduces the CPU globe up to float32 rounding. Output is RGBA = (elevation, moisture,
 * ice, shade) — every per-cell field the renderer needs (plate is for the base-mesh overlay only, so
 * it's omitted). Non-dial constants are baked in; every tuned value is a uniform from TerrainParams.
 */

/**
 * Every scalar dial uniform the field shader reads, with its TerrainParams source — the ONE table
 * that drives BOTH the GLSL `uniform float` declarations (below) and GpuField's uploads, so a
 * uniform can't be declared without being set (silent 0.0) or set without being declared. The
 * getter typechecks against TerrainParams, so a renamed dial fails compile, not render.
 */
export type FieldUniformSpec = { name: string; get: (p: TerrainParams) => number };
export const FIELD_PARAM_UNIFORMS: readonly FieldUniformSpec[] = [
  // CONTINENT
  { name: "uContWavelength", get: (p) => p.CONTINENTS.WAVELENGTH },
  { name: "uContAmplitude", get: (p) => p.CONTINENTS.AMPLITUDE },
  { name: "uContOctaves", get: (p) => p.CONTINENTS.OCTAVES },
  { name: "uContGain", get: (p) => p.CONTINENTS.GAIN },
  { name: "uContLacunarity", get: (p) => p.CONTINENTS.LACUNARITY },
  { name: "uContWarp", get: (p) => p.CONTINENTS.WARP },
  { name: "uBaseHeight", get: (p) => p.CONTINENTS.BASE_HEIGHT },
  { name: "uElevationContrast", get: (p) => p.CONTINENTS.ELEVATION_CONTRAST },
  // OCEAN
  { name: "uSeaLevel", get: (p) => p.OCEANS.SEA_LEVEL },
  { name: "uOceanWavelength", get: (p) => p.OCEANS.WAVELENGTH },
  { name: "uOceanAmplitude", get: (p) => p.OCEANS.AMPLITUDE },
  { name: "uOceanOctaves", get: (p) => p.OCEANS.OCTAVES },
  { name: "uOceanGain", get: (p) => p.OCEANS.GAIN },
  { name: "uOceanLacunarity", get: (p) => p.OCEANS.LACUNARITY },
  // COAST
  { name: "uCoastWavelength", get: (p) => p.COASTS.WAVELENGTH },
  { name: "uCoastAmplitude", get: (p) => p.COASTS.AMPLITUDE },
  { name: "uCoastOctaves", get: (p) => p.COASTS.OCTAVES },
  { name: "uCoastGain", get: (p) => p.COASTS.GAIN },
  { name: "uCoastLacunarity", get: (p) => p.COASTS.LACUNARITY },
  // MOUNTAIN
  { name: "uRidgeWavelength", get: (p) => p.MOUNTAINS.RIDGE_WAVELENGTH },
  { name: "uRidgeAmplitude", get: (p) => p.MOUNTAINS.RIDGE_AMPLITUDE },
  { name: "uMountainOctaves", get: (p) => p.MOUNTAINS.OCTAVES },
  { name: "uMountainGain", get: (p) => p.MOUNTAINS.GAIN },
  { name: "uMountainLacunarity", get: (p) => p.MOUNTAINS.LACUNARITY },
  { name: "uSwellFraction", get: (p) => p.MOUNTAINS.SWELL_FRACTION },
  // LAND RELIEF — gentle continental uplands (fills the mid-elevation band the flat land cap omits).
  { name: "uLandReliefWavelength", get: (p) => p.LAND_RELIEF.WAVELENGTH },
  { name: "uLandReliefAmplitude", get: (p) => p.LAND_RELIEF.AMPLITUDE },
  { name: "uLandReliefOctaves", get: (p) => p.LAND_RELIEF.OCTAVES },
  { name: "uLandReliefGain", get: (p) => p.LAND_RELIEF.GAIN },
  { name: "uLandReliefLacunarity", get: (p) => p.LAND_RELIEF.LACUNARITY },
  // TECTONICS
  { name: "uRangeWidth", get: (p) => p.TECTONICS.RANGE_WIDTH },
  { name: "uSinuosity", get: (p) => p.TECTONICS.SINUOSITY },
  { name: "uConvergenceThreshold", get: (p) => p.TECTONICS.CONVERGENCE_THRESHOLD },
  { name: "uVariation", get: (p) => p.TECTONICS.VARIATION },
  { name: "uCoastBias", get: (p) => p.TECTONICS.COAST_BIAS },
  // MOISTURE
  { name: "uMoistWavelength", get: (p) => p.MOISTURE.WAVELENGTH },
  { name: "uMoistAmplitude", get: (p) => p.MOISTURE.AMPLITUDE },
  { name: "uMoistOctaves", get: (p) => p.MOISTURE.OCTAVES },
  { name: "uMoistGain", get: (p) => p.MOISTURE.GAIN },
  { name: "uMoistLacunarity", get: (p) => p.MOISTURE.LACUNARITY },
  { name: "uMoistContrast", get: (p) => p.MOISTURE.CONTRAST },
  { name: "uMoistRainfall", get: (p) => p.MOISTURE.RAINFALL },
  { name: "uWaterProximityEffect", get: (p) => p.MOISTURE.WATER_PROXIMITY_EFFECT },
  { name: "uDesertSteepness", get: (p) => p.MOISTURE.DESERT_STEEPNESS },
  { name: "uWaterSizeOctaves", get: (p) => p.MOISTURE.WATER_SIZE_OCTAVES },
  { name: "uInteriorDryness", get: (p) => p.MOISTURE.INTERIOR_DRYNESS },
  // CLIMATE — the Köppen classifier's knobs.
  { name: "uSeasonality", get: (p) => p.CLIMATE.SEASONALITY },
  { name: "uContinentalSeasonality", get: (p) => p.CLIMATE.CONTINENTAL_SEASONALITY },
  { name: "uJitter", get: (p) => p.CLIMATE.JITTER },
  { name: "uJitterScale", get: (p) => p.CLIMATE.JITTER_SCALE },
  { name: "uHadley", get: (p) => p.CLIMATE.HADLEY },
  // HILLSHADE scalars (uLight is derived from the azimuth/altitude dials — hand-set, vec3).
  { name: "uExaggeration", get: (p) => p.HILLSHADE.EXAGGERATION },
  { name: "uEpsilon", get: (p) => p.HILLSHADE.EPSILON },
  { name: "uShadeFloor", get: (p) => p.HILLSHADE.FLOOR },
  { name: "uShadeLowlandFloor", get: (p) => p.HILLSHADE.LOWLAND_FLOOR },
  { name: "uShadeMinLandE", get: () => SHADE_MIN_LAND_E },
  // features
  { name: "uMountainsOn", get: (p) => (p.features.mountains ? 1 : 0) },
];

const PARAM_UNIFORM_DECLS = FIELD_PARAM_UNIFORMS.map((s) => `uniform float ${s.name};`).join("\n");

// The fixed (non-dial) constants — GENERATED from fieldConstants.ts / INVARIANTS (one numeric
// source; terrainShader.test.ts guards the emitted block). GLSL keeps its short local names.
const FIXED_CONSTS = glslConstBlock(
  {
    MIN_OCTAVE_AMPLITUDE,
    LAND_HAIR,
    REPORT_INLAND_RISE, // ElevationCalculator: coast→interior rise restored for reportElevation
    RIVER_ROUGH_WL: RIVER_ROUGH_WAVELENGTH, // river routing-height micro-relief (uRiverRoughAmp scales it)
    RIVER_ROUGH_OCT: RIVER_ROUGH_OCTAVES,
    RIVER_ROUGH_GAIN,
    RIVER_ROUGH_LAC: RIVER_ROUGH_LACUNARITY,
    NEUTRAL: INVARIANTS.NEUTRAL_CENTER_POINT,
    RANGE_ENV_WL: RANGE_ENVELOPE_WAVELENGTH, // mountain along-strike envelope
    RANGE_ENV_OFF: RANGE_ENVELOPE_OFFSET,
    MOIST_OFF: MOISTURE_NOISE_OFFSET, // moisture noise decorrelation offset
    RIDGE_FEEDBACK,
    RIDGE_SHARPNESS,
    CONVERGENCE_SOFTNESS, // Tectonics
    JUNCTION_FADE_WIDTH,
    TEC_WARP_WL: TECTONIC_WARP_WAVELENGTH,
    TEC_WARP_OFF_X: TECTONIC_WARP_OFFSET_X,
    TEC_WARP_OFF_Y: TECTONIC_WARP_OFFSET_Y,
    TEC_WARP_OFF_Z: TECTONIC_WARP_OFFSET_Z,
  },
  ""
);

const FIELD_GLSL = /* glsl */ `
// --- fixed (non-dial) constants — GENERATED from fieldConstants.ts (do not hand-edit values here) ---
${FIXED_CONSTS}
// GLSL-only loop bounds (the CPU loops are dynamic; GLSL needs static bounds).
const int   MAX_OCTAVES = 16;
const vec3  WARP_OFF = vec3(${glslFloat(CONTINENT_WARP_OFFSET_X)}, ${glslFloat(CONTINENT_WARP_OFFSET_Y)}, ${glslFloat(CONTINENT_WARP_OFFSET_Z)}); // continent domain-warp offsets
const int   MAX_PLATES = 64;

// --- dials (TerrainParams snapshot) — declarations GENERATED from FIELD_PARAM_UNIFORMS ---
${PARAM_UNIFORM_DECLS}
uniform vec2  uShelf;
uniform vec3  uLight;                 // hillshade light in (east, north, up)
uniform float uEmitReport;            // rivers: 1 = write reportElevation (routing height) into .a instead of shade
uniform float uRiverRoughAmp;         // rivers: micro-relief amplitude folded into the routing height (so trunk flow converges)
uniform int   uPlateCount;
uniform highp sampler2D uPlateTex;    // (uPlateCount x 2): row 0 = plate seeds.xyz, row 1 = Euler poles.xyz

vec3 plateSeed(int i) { return texelFetch(uPlateTex, ivec2(i, 0), 0).xyz; }
vec3 platePole(int i) { return texelFetch(uPlateTex, ivec2(i, 1), 0).xyz; }

// util.ts:applyContrast — contrast curve about the midpoint (sea-level remap + moisture).
float applyContrast(float v, float contrast) {
  float t = clamp(contrast, 0.0, 1.0);
  float u = 2.0 * v - 1.0;
  float e = t <= 0.5 ? mix(3.0, 1.0, t / 0.5) : mix(1.0, 0.2, (t - 0.5) / 0.5);
  float u2 = sign(u) * pow(abs(u), e);
  return clamp((u2 + 1.0) * 0.5, 0.0, 1.0);
}

// fbm.ts:fbm3
float fbm3(vec3 p, float scale, float amplitude, float octaves, float gain, float lacunarity) {
  vec3 s = p / scale;
  float amp = amplitude, sum = 0.0;
  int whole = int(floor(octaves));
  for (int i = 0; i < MAX_OCTAVES; i++) {
    if (i >= whole || amp < MIN_OCTAVE_AMPLITUDE) break;
    sum += amp * snoise(s);
    amp *= gain;
    s *= lacunarity;
  }
  float frac = octaves - float(whole);
  if (frac > 0.0 && amp >= MIN_OCTAVE_AMPLITUDE) sum += amp * smoothstep(0.0, 1.0, frac) * snoise(s);
  return sum;
}

// fbm.ts:ridgedFbm3 — sharp crests with per-octave feedback (max(.,0) guards the rare |noise|>1 that
// would NaN pow(); the CPU's float64 hits the same edge but it's measure-zero terrain).
float ridgedFbm3(vec3 p, float scale, float amplitude, float octaves, float gain, float lacunarity) {
  vec3 s = p / scale;
  float amp = 1.0, weight = 1.0, sum = 0.0, norm = 0.0;
  int whole = int(floor(octaves));
  for (int i = 0; i < MAX_OCTAVES; i++) {
    if (i >= whole) break;
    float n = pow(max(1.0 - abs(snoise(s)), 0.0), RIDGE_SHARPNESS) * weight;
    weight = min(1.0, n * RIDGE_FEEDBACK);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    s *= lacunarity;
  }
  float frac = octaves - float(whole);
  if (frac > 0.0) {
    float w = smoothstep(0.0, 1.0, frac);
    float n = pow(max(1.0 - abs(snoise(s)), 0.0), RIDGE_SHARPNESS) * weight;
    sum += n * amp * w;
    norm += amp * w;
  }
  return norm > 0.0 ? amplitude * sum / norm : 0.0;
}

float continentNoise(vec3 p) { return snoise(p / uContWavelength); }

// ElevationCalculator.continentalness — warp once, then 'full' (CONTINENTS.OCTAVES) and the moisture
// 'broad' low-pass (WATER_SIZE_OCTAVES) off the same warped coords.
void continentalness(vec3 pos, out float full, out float broad) {
  float w = uContWarp;
  vec3 wp = vec3(
    pos.x + w * continentNoise(vec3(pos.x + WARP_OFF.x, pos.y + WARP_OFF.y, pos.z + WARP_OFF.z)),
    pos.y + w * continentNoise(vec3(pos.x - WARP_OFF.y, pos.y - WARP_OFF.z, pos.z - WARP_OFF.x)),
    pos.z + w * continentNoise(vec3(pos.x + WARP_OFF.z, pos.y - WARP_OFF.x, pos.z + WARP_OFF.y))
  );
  full  = clamp(NEUTRAL + fbm3(wp, uContWavelength, uContAmplitude, uContOctaves, uContGain, uContLacunarity), 0.0, 1.0);
  broad = clamp(NEUTRAL + fbm3(wp, uContWavelength, uContAmplitude, uWaterSizeOctaves, uContGain, uContLacunarity), 0.0, 1.0);
}

// Tectonics.warp — meander plate boundaries, re-project onto the unit sphere.
vec3 tecWarp(vec3 p) {
  if (uSinuosity <= 0.0) return p;
  float s = uSinuosity, wl = TEC_WARP_WL;
  vec3 w = vec3(
    p.x + s * snoise(vec3(p.x / wl + TEC_WARP_OFF_X, p.y / wl + TEC_WARP_OFF_X, p.z / wl + TEC_WARP_OFF_X)),
    p.y + s * snoise(vec3(p.x / wl + TEC_WARP_OFF_Y, p.y / wl + TEC_WARP_OFF_Y, p.z / wl + TEC_WARP_OFF_Y)),
    p.z + s * snoise(vec3(p.x / wl + TEC_WARP_OFF_Z, p.y / wl + TEC_WARP_OFF_Z, p.z / wl + TEC_WARP_OFF_Z))
  );
  float len = length(w);
  return len > 0.0 ? w / len : w;
}

// Tectonics.upliftAndPlateAt — mountain placement weight (the plate index is unused for colour).
float uplift(vec3 P) {
  vec3 p = tecWarp(P);
  int iA = 0, iB = 0;
  float dA = -1e30, dB = -1e30, dC = -1e30;
  for (int i = 0; i < MAX_PLATES; i++) {
    if (i >= uPlateCount) break;
    float d = dot(p, plateSeed(i));
    if (d > dA)      { dC = dB; dB = dA; iB = iA; dA = d; iA = i; }
    else if (d > dB) { dC = dB; dB = d; iB = i; }
    else if (d > dC) { dC = d; }
  }
  vec3 chord = plateSeed(iB) - plateSeed(iA);
  float chordLen = max(length(chord), 1e-12);
  float dist = asin(min(1.0, abs(dot(p, chord)) / chordLen));
  float reach = max(0.5 * uRangeWidth, 1e-6);
  float band = 1.0 - smoothstep(0.0, reach, dist);
  if (band <= 0.0) return 0.0;
  vec3 n = chord - dot(chord, p) * p;
  n = normalize(n);
  vec3 rw = platePole(iA) - platePole(iB);
  float convergence = dot(cross(rw, p), n);
  float junction = smoothstep(0.0, JUNCTION_FADE_WIDTH, dB - dC);
  return smoothstep(uConvergenceThreshold, uConvergenceThreshold + CONVERGENCE_SOFTNESS, convergence) * band * junction;
}

// ElevationCalculator.mountainRelief
float mountainRelief(vec3 p, float up) {
  if (uMountainsOn < 0.5 || up <= 0.0) return 0.0;
  float peaks = ridgedFbm3(p, uRidgeWavelength, uRidgeAmplitude, uMountainOctaves, uMountainGain, uMountainLacunarity);
  float v = 0.5 + 0.5 * snoise(vec3(p.x / RANGE_ENV_WL + RANGE_ENV_OFF, p.y / RANGE_ENV_WL + RANGE_ENV_OFF, p.z / RANGE_ENV_WL + RANGE_ENV_OFF));
  float envelope = 1.0 - uVariation * (1.0 - v);
  return up * envelope * (uRidgeAmplitude * uSwellFraction + peaks);
}

// ElevationCalculator.elevationAt — CONTINENT surface (base + OCEAN/COAST relief) + the MOUNTAIN term.
// pos drives the relief + tectonic uplift; C is the (shared) continentalness from the cell centre.
float elevationAt(vec3 pos, float C) {
  float shelf = smoothstep(uShelf.x, uShelf.y, C);
  float base = (C < uShelf.x) ? mix(0.0, uBaseHeight, smoothstep(0.0, uShelf.x, C)) : uBaseHeight;
  float inland = smoothstep(uShelf.y, 1.0, C);
  float detail;
  if (shelf <= 0.0) {
    detail = fbm3(pos, uOceanWavelength, uOceanAmplitude, uOceanOctaves, uOceanGain, uOceanLacunarity);
  } else {
    float coast = (1.0 - inland) * fbm3(pos, uCoastWavelength, uCoastAmplitude, uCoastOctaves, uCoastGain, uCoastLacunarity);
    if (shelf >= 1.0) detail = coast;
    else detail = mix(fbm3(pos, uOceanWavelength, uOceanAmplitude, uOceanOctaves, uOceanGain, uOceanLacunarity), coast, shelf);
  }
  float continent = clamp(base + detail, 0.0, 1.0);
  if (continent < uSeaLevel) return continent;
  float land = min(continent, uSeaLevel + LAND_HAIR);
  // LAND_RELIEF — gentle continental uplands on the flat land base (ElevationCalculator: rectified positive,
  // gated to land), filling the mid-elevation band the cap omits without moving the coastline.
  float landRelief = shelf * max(0.0, fbm3(pos, uLandReliefWavelength, uLandReliefAmplitude, uLandReliefOctaves, uLandReliefGain, uLandReliefLacunarity));
  float mountainWeight = shelf * (1.0 - uCoastBias * inland);
  float mountains = mountainWeight * mountainRelief(pos, uplift(pos));
  return clamp(max(land + landRelief + mountains, uSeaLevel), 0.0, 1.0);
}

// ElevationCalculator.reportElevationAt — the routing height for rivers. The rendered elevation
// caps non-mountain land flat (one green band), so flow has no gradient to follow there; this restores
// a continentalness-driven coast-to-interior rise (+ the real mountain relief) so water runs seaward.
float reportElevationAt(float C, float renderedElevation) {
  if (renderedElevation < uSeaLevel) return renderedElevation; // ocean: keep its depth (a flow sink)
  float inland = smoothstep(uShelf.y, 1.0, C);
  float mtn = max(0.0, renderedElevation - (uSeaLevel + LAND_HAIR));
  return clamp(uSeaLevel + inland * REPORT_INLAND_RISE + mtn, 0.0, 1.0);
}

// ElevationCalculator.moistureAt — climate is always generated now (the viewClimate toggle switches the
// COLOUR at draw, not the field), so there is no generation gate here; mirrors the CPU moistureAt.
float moistureAt(vec3 site, float cont, float broadCont) {
  float raw = fbm3(vec3(site.x + MOIST_OFF, site.y + MOIST_OFF, site.z + MOIST_OFF), uMoistWavelength, uMoistAmplitude, uMoistOctaves, uMoistGain, uMoistLacunarity);
  float m = clamp(NEUTRAL + raw, 0.0, 1.0);
  float oceanic = min(cont, broadCont);
  float waterProximity = pow(1.0 - oceanic, uDesertSteepness);
  m = mix(m, 1.0, uWaterProximityEffect * waterProximity);
  // Interior dryness — the inverse of maritime humidity: deep continental interiors lose moisture, placing
  // the Gobi / Sahara-heart / Great-Basin drylands far from any coast. inland = 0 at the shelf → 1 deep inland.
  float inland = smoothstep(uShelf.y, 1.0, cont);
  m = mix(m, 0.0, uInteriorDryness * inland);
  return applyContrast(m * uMoistRainfall, uMoistContrast);
}

// ElevationCalculator.hillshadeAt — relief shading over all land, with aerial perspective: shadow depth
// grows with elevation (plains use the shallow uShadeLowlandFloor, mountains the deep uShadeFloor), so
// lowlands gain gentle form while peaks stay dramatic. Two offset elevationAt samples reuse the centre C.
float hillshadeAt(vec3 site, float C, float h0) {
  float cwl = applyContrast(uSeaLevel, uElevationContrast);
  float ec = applyContrast(h0, uElevationContrast);
  if (ec < cwl) return 1.0;  // ocean: flat-lit
  float landE = min((ec - cwl) / (1.0 - cwl), 1.0 - 1e-9);
  float x = site.x, y = site.y, z = site.z;
  float nx = -y * x, ny = 1.0 - y * y, nz = -y * z;
  float nl = length(vec3(nx, ny, nz));
  if (nl < 1e-4) { nx = 1.0 - x * x; ny = -x * y; nz = -x * z; nl = length(vec3(nx, ny, nz)); }
  nx /= nl; ny /= nl; nz /= nl;
  float ex = y * nz - z * ny, ey = z * nx - x * nz, ez = x * ny - y * nx;
  float e = uEpsilon;
  float hE = elevationAt(vec3(x + ex * e, y + ey * e, z + ez * e), C);
  float hN = elevationAt(vec3(x + nx * e, y + ny * e, z + nz * e), C);
  float k = uExaggeration;
  float nE = -k * (hE - h0), nN = -k * (hN - h0);
  float len = length(vec3(nE, nN, 1.0));
  float dotv = (nE * uLight.x + nN * uLight.y + uLight.z) / len;
  // Aerial perspective: floor ramps from shallow (plains) to deep (mountains) by uShadeMinLandE.
  float floorE = mix(uShadeLowlandFloor, uShadeFloor, smoothstep(0.0, uShadeMinLandE, landE));
  return mix(floorE, 1.0, clamp(dotv, 0.0, 1.0));
}

${KOPPEN_GLSL}

// ElevationCalculator.iceAt — ice is Köppen-only: the polar lowland zones (tundra ET / ice-cap EF). Written
// to .b on the rivers pass so rivers aren't routed over iced land; mirrors CPU iceAt(koppenZone).
float iceAt(float koppenZone) {
  return (koppenZone == float(KZ_ET) || koppenZone == float(KZ_EF)) ? 1.0 : 0.0;
}

// The full per-cell field — the GPU twin of ElevationCalculator.sampleCell (minus the plate index).
vec4 field(vec3 site) {
  float full, broad;
  continentalness(site, full, broad);
  float elev = elevationAt(site, full);
  float moist = moistureAt(site, full, broad);
  // .a carries shade for the renderer, OR the river routing height (reportElevation) when sampling
  // for rivers — an if (not ?:) so the unused branch's work is skipped and the render path is unchanged.
  // reportElevation = the UNCAPPED real height (mountains restored). The climate classifier reads it for the
  // lapse-rate temperature, and the rivers pass routes on it — computed once, matching CPU sampleCell.
  float reportElev = reportElevationAt(full, elev);
  float a;
  if (uEmitReport > 0.5) {
    a = reportElev;
    // Micro-relief on LAND so trunk flow CONVERGES into a dendritic network instead of running parallel
    // down the smooth continental ramp (the "lined-up" look). Ocean stays a clean sink.
    if (elev >= uSeaLevel) a += uRiverRoughAmp * fbm3(site, RIVER_ROUGH_WL, 1.0, RIVER_ROUGH_OCT, RIVER_ROUGH_GAIN, RIVER_ROUGH_LAC);
  } else {
    a = hillshadeAt(site, full, elev);
  }
  // .b: the colour + base passes read the KÖPPEN ZONE (E/EF is the single source for frozen colour); the
  // rivers pass (uEmitReport) reads the ice mask DERIVED from that same zone (ET/EF) so rivers aren't routed
  // over iced land — matching CPU map.ice. continentality (interior-ness) feeds the synthesized seasonal swing.
  float continentality = smoothstep(uShelf.y, 1.0, full);
  float zone = koppenZone(site, elev, reportElev, moist, continentality, uSeaLevel, uSeasonality, uContinentalSeasonality, uJitter, uJitterScale, uHadley);
  float b = uEmitReport > 0.5 ? iceAt(zone) : zone;
  return vec4(elev, moist, b, a);
}
`;

// Full-screen triangle from gl_VertexID — no vertex buffers. One fragment per output texel.
export const FIELD_VERT_SRC = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Fragment shader: map this texel to a flat cell index, fetch its site, write the full field to RGBA
// (r=elevation, g=moisture, b=ice, a=shade).
export const FIELD_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSites; // RGBA32F: one cell site (xyz) per texel
uniform int uWidth;             // sites/output texture width (texels)
uniform int uCount;             // number of real cells (texels past this are padding)
out vec4 fragColor;

${EXACT_SNOISE_GLSL}
${FIELD_GLSL}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  int index = texel.y * uWidth + texel.x;
  if (index >= uCount) { fragColor = vec4(0.0); return; }
  fragColor = field(texelFetch(uSites, texel, 0).xyz);
}`;
