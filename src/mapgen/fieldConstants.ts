// The fixed (non-dial) magic numbers of the per-cell field model — warp offsets, ridge feedback,
// ice-cap shape, plate-collision softness. ONE source for the CPU sampler (fbm.ts / ElevationCalculator.ts
// / Tectonics.ts all import from here) so they can't drift between those files; the GPU shader
// (gpu/terrainShader.ts) hand-mirrors the same values, and terrainShader.test.ts asserts the GLSL block
// still matches THIS module — so the two implementations of the field can't silently diverge either.
//
// Dial-driven values live in settings.ts (DIALS); these are the ones not worth a dial. The CPU files
// import with their own local aliases (e.g. WARP_OFFSET_X) so the hot functions read unchanged.

// --- fbm.ts (octave stack) ---
// An octave whose amplitude is below this contributes < ~0.6% of a unit field — under the renderer's
// colour quantization — so it's skipped.
export const MIN_OCTAVE_AMPLITUDE = 0.006;
// Ridged-multifractal per-octave crest gating (higher = sharper, more branched ridgelines).
export const RIDGE_FEEDBACK = 2.5;
// Crest sharpening exponent: (1 - |noise|) ^ this (higher = pointier peaks, broader valleys).
export const RIDGE_SHARPNESS = 3.5;

// --- ElevationCalculator.ts ---
// Land base capped this far above the waterline so only the MOUNTAIN wave lifts land into higher bands.
export const LAND_HAIR = 0.02;
// River ROUTING height: the continentalness-driven coast→interior rise restored on top of the flat
// rendered land (so flow has a seaward gradient), and the micro-relief fbm folded in on land (so trunk
// flow converges dendritically instead of combing parallel). RIVERS.ROUGHNESS scales the micro-relief.
export const REPORT_INLAND_RISE = 0.07;
export const RIVER_ROUGH_WAVELENGTH = 0.06;
export const RIVER_ROUGH_OCTAVES = 5;
export const RIVER_ROUGH_GAIN = 0.55;
export const RIVER_ROUGH_LACUNARITY = 2;
// Continent domain-warp offsets (decorrelate the warp lookups from the base field).
export const CONTINENT_WARP_OFFSET_X = 5.2;
export const CONTINENT_WARP_OFFSET_Y = 1.7;
export const CONTINENT_WARP_OFFSET_Z = 9.3;
// Mountain along-strike envelope (swells / pinches / gaps a range along its length).
export const RANGE_ENVELOPE_WAVELENGTH = 0.5;
export const RANGE_ENVELOPE_OFFSET = 19.7;
// Decorrelate the moisture noise from the elevation field.
export const MOISTURE_NOISE_OFFSET = 25;

// --- climate (Köppen) jitter ---
// Latitude wobble fed into the classifier's precipitation-REGIME windows (the mediterranean /
// monsoon latitude bands in koppen.ts:precipMode). Temperature and moisture thresholds already
// meander via their own jitter terms; without this, the raw-latitude window edges draw perfect
// circles around the globe (the "distinctive green/tan line"). Degrees of drift at full
// CLIMATE.JITTER, sampled at the same wavelength (JITTER_SCALE) as the other climate mottling.
export const CLIMATE_LAT_JITTER_DEG = 10;
export const CLIMATE_LAT_JITTER_OFFSET_X = 47.3;
export const CLIMATE_LAT_JITTER_OFFSET_Y = 9.1;
export const CLIMATE_LAT_JITTER_OFFSET_Z = 33.7;

// --- Tectonics.ts ---
// Ramp width above CONVERGENCE_THRESHOLD to a full-height range (stronger collisions → taller ranges).
export const CONVERGENCE_SOFTNESS = 0.1;
// Width over which a range fades to nothing approaching a triple junction (a smooth gap, not a hard cut).
export const JUNCTION_FADE_WIDTH = 0.06;
// Plate-boundary domain warp (SINUOSITY scales it): wavelength + per-axis decorrelation offsets.
export const TECTONIC_WARP_WAVELENGTH = 0.7;
export const TECTONIC_WARP_OFFSET_X = 8.3;
export const TECTONIC_WARP_OFFSET_Y = 27.1;
export const TECTONIC_WARP_OFFSET_Z = 53.9;
