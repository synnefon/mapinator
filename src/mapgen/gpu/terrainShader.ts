import { EXACT_SNOISE_GLSL } from "./exactSnoise.glsl";

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

const FIELD_GLSL = /* glsl */ `
// --- fixed (non-dial) constants, mirroring fbm.ts / ElevationCalculator / Tectonics ---
const float MIN_OCTAVE_AMPLITUDE = 0.006;
const float LAND_HAIR = 0.02;
const float REPORT_INLAND_RISE = 0.07;                // ElevationCalculator: coast→interior rise restored for reportElevation
const float RIVER_ROUGH_WL = 0.06;                    // wavelength of the river routing-height micro-relief (uRiverRoughAmp scales it)
const float NEUTRAL = 0.5;
const int   MAX_OCTAVES = 16;
const vec3  WARP_OFF = vec3(5.2, 1.7, 9.3);          // continent domain-warp offsets
const float RANGE_ENV_WL = 0.5;                       // mountain along-strike envelope
const float RANGE_ENV_OFF = 19.7;
const float MOIST_OFF = 25.0;                         // moisture noise decorrelation offset
const float ICE_RUFFLE_OFF = 53.1;
const float ICE_RUFFLE_FREQ = 4.2;
const float ICE_HOLE_FREQ = 10.0;
const float ICE_HOLE_SOFT = 0.15;
const float RIDGE_FEEDBACK = 2.5;
const float RIDGE_SHARPNESS = 3.5;
const float CONVERGENCE_SOFTNESS = 0.4;               // Tectonics
const float JUNCTION_FADE_WIDTH = 0.06;
const float TEC_WARP_WL = 0.7;
const float TEC_WARP_OFF_X = 8.3;
const float TEC_WARP_OFF_Y = 27.1;
const float TEC_WARP_OFF_Z = 53.9;
const int   MAX_PLATES = 64;

// --- dials (TerrainParams snapshot) ---
uniform float uContWavelength, uContAmplitude, uContOctaves, uContGain, uContLacunarity, uContWarp, uBaseHeight, uElevationContrast;
uniform float uSeaLevel, uOceanWavelength, uOceanAmplitude, uOceanOctaves, uOceanGain, uOceanLacunarity;
uniform float uCoastWavelength, uCoastAmplitude, uCoastOctaves, uCoastGain, uCoastLacunarity;
uniform vec2  uShelf;
uniform float uRidgeWavelength, uRidgeAmplitude, uMountainOctaves, uMountainGain, uMountainLacunarity, uSwellFraction;
uniform float uRangeWidth, uSinuosity, uConvergenceThreshold, uVariation, uCoastBias;
uniform float uMoistWavelength, uMoistAmplitude, uMoistOctaves, uMoistGain, uMoistLacunarity, uMoistContrast, uWaterProximityEffect, uDesertSteepness, uWaterSizeOctaves;
uniform float uIceCoverage, uIceWobble, uIceFill, uIceBlend;
uniform vec3  uLight;                 // hillshade light in (east, north, up)
uniform float uExaggeration, uEpsilon, uShadeFloor, uShadeMinLandE;
uniform float uMountainsOn, uClimateOn, uIceOn;   // feature switches (1 = on)
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

// ElevationCalculator.continentalness — warp once, then 'full' (CONTINENT.OCTAVES) and the moisture
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
  float mountainWeight = shelf * (1.0 - uCoastBias * inland);
  float mountains = mountainWeight * mountainRelief(pos, uplift(pos));
  return clamp(max(land + mountains, uSeaLevel), 0.0, 1.0);
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

// ElevationCalculator.moistureAt
float moistureAt(vec3 site, float cont, float broadCont) {
  if (uClimateOn < 0.5) return NEUTRAL;
  float raw = fbm3(vec3(site.x + MOIST_OFF, site.y + MOIST_OFF, site.z + MOIST_OFF), uMoistWavelength, uMoistAmplitude, uMoistOctaves, uMoistGain, uMoistLacunarity);
  float m = clamp(NEUTRAL + raw, 0.0, 1.0);
  float oceanic = min(cont, broadCont);
  float waterProximity = pow(1.0 - oceanic, uDesertSteepness);
  m = mix(m, 1.0, uWaterProximityEffect * waterProximity);
  return applyContrast(m, uMoistContrast);
}

// ElevationCalculator.iceAt — polar cap on land, wobbled edge + holes.
float iceAt(vec3 site, float elevation) {
  if (uIceOn < 0.5) return 0.0;
  float coverage = clamp(uIceCoverage, 0.0, 1.0);
  float line = 1.0 - coverage;
  float f = ICE_RUFFLE_FREQ, o = ICE_RUFFLE_OFF;
  float wobble = uIceWobble * (snoise(vec3(site.x * f + o, site.y * f + o, site.z * f + o))
    + 0.5 * snoise(vec3(site.x * f * 3.0 + o, site.y * f * 3.0 + o, site.z * f * 3.0 + o)));
  float inCap = smoothstep(line - uIceBlend, line, abs(site.y) + wobble);
  if (inCap <= 0.0) return 0.0;
  if (elevation < uSeaLevel) return 0.0;
  float h = 0.5 + 0.5 * snoise(vec3(site.x * ICE_HOLE_FREQ + ICE_RUFFLE_OFF, site.y * ICE_HOLE_FREQ + ICE_RUFFLE_OFF, site.z * ICE_HOLE_FREQ + ICE_RUFFLE_OFF));
  float solid = smoothstep(1.0 - uIceFill, 1.0 - uIceFill + ICE_HOLE_SOFT, h);
  return inCap * solid;
}

// ElevationCalculator.hillshadeAt — mountains-only relief shading (the family gate becomes the
// uShadeMinLandE threshold; below it, flat-lit = 1). Two offset elevationAt samples reuse the centre C.
float hillshadeAt(vec3 site, float C, float h0) {
  float cwl = applyContrast(uSeaLevel, uElevationContrast);
  float ec = applyContrast(h0, uElevationContrast);
  if (ec < cwl) return 1.0;
  float landE = min((ec - cwl) / (1.0 - cwl), 1.0 - 1e-9);
  if (landE < uShadeMinLandE) return 1.0;
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
  return mix(uShadeFloor, 1.0, clamp(dotv, 0.0, 1.0));
}

// The full per-cell field — the GPU twin of ElevationCalculator.sampleCell (minus the plate index).
vec4 field(vec3 site) {
  float full, broad;
  continentalness(site, full, broad);
  float elev = elevationAt(site, full);
  float moist = moistureAt(site, full, broad);
  float ice = iceAt(site, elev);
  // .a carries shade for the renderer, OR the river routing height (reportElevation) when sampling
  // for rivers — an if (not ?:) so the unused branch's work is skipped and the render path is unchanged.
  float a;
  if (uEmitReport > 0.5) {
    a = reportElevationAt(full, elev);
    // Micro-relief on LAND so trunk flow CONVERGES into a dendritic network instead of running parallel
    // down the smooth continental ramp (the "lined-up" look). Ocean stays a clean sink.
    if (elev >= uSeaLevel) a += uRiverRoughAmp * fbm3(site, RIVER_ROUGH_WL, 1.0, 5.0, 0.55, 2.0);
  } else {
    a = hillshadeAt(site, full, elev);
  }
  return vec4(elev, moist, ice, a);
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
