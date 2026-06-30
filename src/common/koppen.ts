import { hexToRgb } from "./colorUtils";

/**
 * Full Köppen–Geiger climate classification (with SYNTHESIZED seasonality), mapped to a stylized
 * EARTH palette — saturated tropical greens, warm desert tans/ochres, temperate greens, dark boreal
 * blue-greens, tundra grey, ice white — NOT the scientific blue/red/purple Köppen map scheme.
 *
 * This is the SINGLE SOURCE for the classifier + the palette. It is mirrored line-for-line in GLSL
 * (src/mapgen/gpu/koppen.glsl.ts) the same way ElevationCalculator ↔ terrainShader are kept in sync —
 * the classifier runs inside the per-cell FIELD (ElevationCalculator.sampleCell on the CPU, the field
 * shader on the GPU), which already has latitude, elevation, moisture and continentalness. The field
 * stores the resulting zone id; both colour paths then just look up `KOPPEN_COLORS[zone]`.
 *
 * "Full seasonal Köppen" needs a summer/winter temperature SWING (the C-vs-D-vs-E splits, the desert
 * h/k splits). A static planet has no seasons, so we synthesize the swing from latitude + continentality
 * (oceans are mild year-round; deep interiors swing hard — Siberia, the Dakotas). That is why the
 * continentality signal earns the .b channel: it unlocks real D/E classification.
 *
 * The third Köppen letter (f/s/w = no-dry-season / dry-summer / dry-winter) needs precipitation TIMING,
 * which a static field also lacks. We approximate it geometrically (see precipRegime). This is the one
 * place we knowingly cut the climatology corner — TODO(monsoon): a real prevailing-wind / monsoon model
 * (revisited with mountains) would replace the proxy.
 */

// ===================== Zone indices =====================
// Ocean is kept as three discrete depth bands (ocean isn't the focus — just preserved, depth-shaded).
// Land is the full 31-zone Köppen-Geiger set. Indices are contiguous so the GPU can index a uniform
// vec3[] directly; keep KOPPEN_COLORS aligned to these.
export const KZ = {
  OCEAN_DEEP: 0,
  OCEAN_MID: 1,
  OCEAN_SHALLOW: 2,
  // A — tropical
  Af: 3, // rainforest
  Am: 4, // monsoon
  Aw: 5, // savanna (dry winter)
  As: 6, // savanna (dry summer)
  // B — arid
  BWh: 7, // hot desert
  BWk: 8, // cold desert
  BSh: 9, // hot steppe
  BSk: 10, // cold steppe
  // C — temperate
  Csa: 11, Csb: 12, Csc: 13, // dry-summer (mediterranean)
  Cwa: 14, Cwb: 15, Cwc: 16, // dry-winter (humid subtropical / highland)
  Cfa: 17, Cfb: 18, Cfc: 19, // no dry season (humid subtropical / oceanic)
  // D — continental
  Dsa: 20, Dsb: 21, Dsc: 22, Dsd: 23, // dry-summer
  Dwa: 24, Dwb: 25, Dwc: 26, Dwd: 27, // dry-winter
  Dfa: 28, Dfb: 29, Dfc: 30, Dfd: 31, // no dry season (incl. taiga Dfc/Dfd)
  // E — polar
  ET: 32, // tundra
  EF: 33, // ice cap
  // Highland — mountains above the (temperature) treeline: the green→grey→white ramp, by altitude + temp.
  // Distinct from the polar LOWLAND tundra/ice (ET/EF): these are the steep, high, geomorphic bands.
  ALPINE: 34, // alpine meadow / krummholz just above the treeline
  BARE: 35, // bare rock / scree — the grey band below the snowline
} as const;

export const KOPPEN_ZONE_COUNT = 36;

// ===================== Earth-like palette (hex), aligned to KZ =====================
// Families read as families: tropical = bright/saturated greens, arid = warm tans→ochres→khaki,
// temperate = clean greens, mediterranean = olives, continental = greens darkening into blue-green
// taiga, tundra = cool grey, ice = white. Subtle gradations within a family are intentional (your
// call: ~30 distinct colours, fine if subtly different). Tune freely — these are just constants.
export const KOPPEN_COLORS: string[] = [];
KOPPEN_COLORS[KZ.OCEAN_DEEP] = "#2b577f"; // deep open water
KOPPEN_COLORS[KZ.OCEAN_MID] = "#316290"; // mid depth
KOPPEN_COLORS[KZ.OCEAN_SHALLOW] = "#3b74a6"; // shelf / shallow
// A — tropical (lush, saturated)
KOPPEN_COLORS[KZ.Af] = "#1b6b2e"; // rainforest — deep emerald
KOPPEN_COLORS[KZ.Am] = "#2c8a3c"; // monsoon — rich green
KOPPEN_COLORS[KZ.Aw] = "#8fae46"; // savanna (dry winter) — warm yellow-green
KOPPEN_COLORS[KZ.As] = "#9cb453"; // savanna (dry summer) — slightly drier
// B — arid (tans → ochres → khaki)
KOPPEN_COLORS[KZ.BWh] = "#e0c285"; // hot desert — warm sand
KOPPEN_COLORS[KZ.BWk] = "#cfc79e"; // cold desert — pale grey-tan
KOPPEN_COLORS[KZ.BSh] = "#cba968"; // hot steppe — ochre
KOPPEN_COLORS[KZ.BSk] = "#bcb57a"; // cold steppe — khaki
// C — temperate
KOPPEN_COLORS[KZ.Csa] = "#b6a95c"; // hot-summer mediterranean — olive-tan
KOPPEN_COLORS[KZ.Csb] = "#a3a85a"; // warm-summer mediterranean — olive
KOPPEN_COLORS[KZ.Csc] = "#95a867"; // cool mediterranean — muted olive-green
KOPPEN_COLORS[KZ.Cwa] = "#5ba146"; // dry-winter humid subtropical — green
KOPPEN_COLORS[KZ.Cwb] = "#69a953"; // dry-winter subtropical highland
KOPPEN_COLORS[KZ.Cwc] = "#76a862"; // dry-winter cold highland
KOPPEN_COLORS[KZ.Cfa] = "#46a050"; // humid subtropical — vivid green
KOPPEN_COLORS[KZ.Cfb] = "#57a95c"; // oceanic — clean mid-green
KOPPEN_COLORS[KZ.Cfc] = "#6fa46a"; // subpolar oceanic — cooler green
// D — continental (greens darkening into taiga blue-green)
KOPPEN_COLORS[KZ.Dsa] = "#9a9a50"; // dry-summer continental, hot
KOPPEN_COLORS[KZ.Dsb] = "#8f9a58";
KOPPEN_COLORS[KZ.Dsc] = "#7e8e5c";
KOPPEN_COLORS[KZ.Dsd] = "#74865e"; // very cold
KOPPEN_COLORS[KZ.Dwa] = "#5e9a48"; // dry-winter continental, hot
KOPPEN_COLORS[KZ.Dwb] = "#4f8c46";
KOPPEN_COLORS[KZ.Dwc] = "#3c7a4a"; // taiga
KOPPEN_COLORS[KZ.Dwd] = "#356e48"; // cold taiga
KOPPEN_COLORS[KZ.Dfa] = "#4c9148"; // hot-summer humid continental
KOPPEN_COLORS[KZ.Dfb] = "#3f8246"; // warm-summer humid continental
KOPPEN_COLORS[KZ.Dfc] = "#2f6b4a"; // subarctic taiga — dark blue-green
KOPPEN_COLORS[KZ.Dfd] = "#28604a"; // extremely cold subarctic — darkest
// E — polar
KOPPEN_COLORS[KZ.ET] = "#9fa896"; // tundra — cool grey-green
KOPPEN_COLORS[KZ.EF] = "#f2f5f7"; // ice cap — white
// Highland ramp (mountains above treeline): alpine grey-green → bare grey-brown scree → snow (EF, white)
KOPPEN_COLORS[KZ.ALPINE] = "#8f9c81"; // alpine meadow / krummholz — cool grey-green
KOPPEN_COLORS[KZ.BARE] = "#9c948a"; // bare rock / scree — grey-brown

/** Palette as a flat Float32Array (zone*3 → r,g,b in 0..1), for `gl.uniform3fv`. Built once. */
export const KOPPEN_RGB: Float32Array = (() => {
  const out = new Float32Array(KOPPEN_ZONE_COUNT * 3);
  for (let z = 0; z < KOPPEN_ZONE_COUNT; z++) {
    const rgb = hexToRgb(KOPPEN_COLORS[z] ?? "#ff00ff") ?? { r: 255, g: 0, b: 255 };
    out[3 * z] = rgb.r / 255;
    out[3 * z + 1] = rgb.g / 255;
    out[3 * z + 2] = rgb.b / 255;
  }
  return out;
})();

// ===================== Mean annual temperature (°C) =====================
// Moved here from features/suitability.ts so the temperature model lives with the climate it drives —
// suitability now imports meanAnnualTempC from this module (single source). Sea-level MAT by |latitude|:
// ~27 °C at the equator falling to deep polar cold; the 1.4 exponent keeps the tropics broad and steepens
// the mid-latitudes (≈14 °C at 40°, ≈0 °C at 60°). Elevation cools it via the environmental lapse rate.
export const MAT_EQUATOR_C = 27;
export const MAT_POLE_C = -25;
export const LATITUDE_FALLOFF = 1.4;
const LAPSE_C_PER_M = 0.0065;
const EVEREST_M = 8849;

/** A cell's mean annual temperature in °C, from its latitude and (lapse-rate-cooled) elevation.
 *  `displayElevation` is the [0,1] height; `seaLevel` is the waterline the caller uses. */
export function meanAnnualTempC(latDeg: number, displayElevation: number, seaLevel: number): number {
  const a = Math.min(1, Math.abs(latDeg) / 90);
  const sealevelMat = MAT_EQUATOR_C - (MAT_EQUATOR_C - MAT_POLE_C) * a ** LATITUDE_FALLOFF;
  const frac = Math.max(0, (displayElevation - seaLevel) / Math.max(1 - seaLevel, 1e-6));
  return sealevelMat - LAPSE_C_PER_M * frac * EVEREST_M;
}

// ===================== Synthesized seasonality =====================
// The summer↔winter half-amplitude (°C): coasts are mild, deep interiors swing hard, and the swing grows
// toward the poles (the tropics are nearly seasonless in temperature). Twarm = MAT + amp, Tcold = MAT − amp.
/** `lat0to1` = |lat|/90; `continentality` ∈ [0,1] = how deep in a landmass interior the cell sits. */
export function seasonalAmplitudeC(
  lat0to1: number,
  continentality: number,
  base: number,
  continentalWeight: number
): number {
  // Latitude shape: ~0 at the equator → 1 by the mid/high latitudes (seasonality is a temperate/polar
  // phenomenon). Smooth, monotone; squared keeps the tropics flat.
  const latShape = lat0to1 * lat0to1;
  return base * latShape * (1 + continentalWeight * continentality);
}

// ===================== Moisture → annual precipitation (mm) =====================
// Köppen's aridity rules are in mm/yr; our moisture field is [0,1]. Map it once here (a squared ramp so
// the dry end stays sparse — most of [0,1] reads as moderate, the wettest tail as rainforest-class).
const MAX_PRECIP_MM = 3000;
export function moistureToPrecipMm(moisture: number): number {
  const m = Math.max(0, Math.min(1, moisture));
  return m * m * MAX_PRECIP_MM;
}

// Earth's zonal rain bands (the Hadley circulation): wettest at the equator (the ITCZ), DRIEST at the
// ±~27° "horse latitudes" where descending dry air makes the great deserts (Sahara, Atacama, Australian),
// wetter again under the mid-latitude storm tracks (~50°), then dry at the poles. Multiplies precipitation,
// so even a wet-noise cell at 27° trends arid → deserts + rainforests land in their recognizable latitude
// bands. `strength` (CLIMATE.HADLEY) fades the whole effect: 0 = off (factor 1 everywhere), 1 = full bands.
const gauss1 = (x: number, mu: number, sigma: number): number =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
export function hadleyPrecipFactor(absLatDeg: number, strength: number): number {
  const itcz = gauss1(absLatDeg, 0, 13); // equatorial wet belt
  const stormTrack = 0.65 * gauss1(absLatDeg, 50, 18); // mid-latitude wet belt
  const shaped = 0.3 + 0.7 * Math.max(itcz, stormTrack); // 0.3 floor so latitude alone never hard-zeroes rain
  return 1 + strength * (shaped - 1);
}

// ===================== Köppen classifier =====================
// Precipitation-timing regime (the third letter), approximated from latitude band + moisture:
//   1 = dry-summer (s, mediterranean)  ·  2 = dry-winter (w, monsoon/savanna)  ·  0 = no dry season (f)
// TODO(monsoon): replace this geometric proxy with a real prevailing-wind / monsoon model (with mountains).
const MED_LAT: [number, number] = [28, 45]; // subtropical belt where dry-summer (mediterranean) appears
const MED_MOIST: [number, number] = [0.25, 0.62]; // ...and only when moderately (not super-) wet
const MED_MAX_CONTINENTALITY = 0.45; // ...and only near a coast (mediterranean climates hug the west margins)
const MOUNTAIN_LAND_E = 0.18; // land elevation (0 = shore, 1 = highest peak) above which a cell is a MOUNTAIN
function precipRegime(absLatDeg: number, moisture: number, continentality: number): number {
  const subtropical = absLatDeg >= MED_LAT[0] && absLatDeg <= MED_LAT[1];
  // dry-summer (mediterranean): subtropical, COASTAL (low continentality), moderately — not super- — wet.
  if (subtropical && continentality < MED_MAX_CONTINENTALITY && moisture >= MED_MOIST[0] && moisture <= MED_MOIST[1]) return 1;
  if (absLatDeg < 28 && moisture < 0.55) return 2; // low-latitude dry-winter (savanna/monsoon margin)
  return 0; // no marked dry season
}

// Fourth letter (summer-heat / continentality), as 0=a,1=b,2=c,3=d from the warm/cold extremes.
function heatLetter(tWarm: number, tCold: number): number {
  if (tCold < -38) return 3; // d — extremely cold winter (only meaningful for D)
  if (tWarm >= 22) return 0; // a — hot summer
  if (tWarm >= 16) return 1; // b — warm summer
  return 2; // c — cool/short summer
}

/**
 * Classify one cell into a Köppen zone index (KZ.*). Pure + numeric so the GLSL twin can mirror it
 * branch-for-branch. Ocean (elevation below the waterline) is bucketed into three depth bands instead.
 *   matC  — mean annual temperature (°C, already jittered by the caller for mottling)
 *   tWarm/tCold — warmest/coldest "month" = matC ± seasonal amplitude
 *   precipMm — annual precipitation (from moistureToPrecipMm)
 *   absLatDeg, moisture — for the precip-timing proxy
 *   elevation, seaLevel — land/ocean split + ocean depth banding
 */
export function classifyKoppen(
  matC: number,
  tWarm: number,
  tCold: number,
  precipMm: number,
  absLatDeg: number,
  moisture: number,
  elevation: number,
  seaLevel: number,
  continentality: number
): number {
  // --- ocean: three depth bands across [0, seaLevel] ---
  if (elevation < seaLevel) {
    const d = elevation / Math.max(seaLevel, 1e-6); // 0 = deepest, ~1 = at the shore
    if (d < 0.34) return KZ.OCEAN_DEEP;
    if (d < 0.7) return KZ.OCEAN_MID;
    return KZ.OCEAN_SHALLOW;
  }

  // --- E / highland: below the warm-season treeline. On a MOUNTAIN (high land elevation) this becomes the
  // rock/snow ramp (alpine → bare scree → snow); on low ground it's the polar lowland (tundra / ice sheet).
  // Elevation cools temperature via the lapse rate upstream, so a tall tropical peak lands here too — and
  // the treeline sits HIGHER in the tropics (more lapse needed to reach it), as on Earth.
  const landE = (elevation - seaLevel) / Math.max(1 - seaLevel, 1e-6); // 0 at the shore → 1 at the highest peak
  if (tWarm < 10) {
    if (landE > MOUNTAIN_LAND_E) {
      if (tWarm < -8) return KZ.EF; // perennial snow / ice
      if (tWarm < 3) return KZ.BARE; // bare rock / scree (grey)
      return KZ.ALPINE; // alpine meadow / shrub just above the treeline
    }
    return tWarm < 0 ? KZ.EF : KZ.ET; // polar LOWLAND: ice sheet / tundra
  }

  const regime = precipRegime(absLatDeg, moisture, continentality);

  // --- B (arid): annual precip below the aridity threshold ---
  // Pth = 20·MAT + seasonal offset (winter-wet 0, even 140, summer-wet 280). h/k split at MAT 18 °C.
  const offset = regime === 1 ? 0 : regime === 2 ? 280 : 140;
  const pth = Math.max(0, 20 * matC + offset);
  if (precipMm < pth) {
    const hot = matC >= 18;
    if (precipMm < 0.5 * pth) return hot ? KZ.BWh : KZ.BWk; // desert
    return hot ? KZ.BSh : KZ.BSk; // steppe
  }

  // --- A (tropical): coldest month ≥ 18 °C ---
  if (tCold >= 18) {
    if (moisture > 0.82) return KZ.Af; // perpetually wet → rainforest
    if (moisture > 0.6) return KZ.Am; // intermediate → monsoon
    return regime === 1 ? KZ.As : KZ.Aw; // savanna (dry-summer rare → As, else Aw)
  }

  // --- C / D (temperate / continental) ---
  const heat = heatLetter(tWarm, tCold);
  if (tCold >= 0) {
    // C — temperate (no 'd'; clamp to a/b/c)
    const h = Math.min(heat, 2);
    if (regime === 1) return KZ.Csa + h;
    if (regime === 2) return KZ.Cwa + h;
    return KZ.Cfa + h;
  }
  // D — continental (a/b/c/d)
  if (regime === 1) return KZ.Dsa + heat;
  if (regime === 2) return KZ.Dwa + heat;
  return KZ.Dfa + heat;
}

// ===================== Biome categories (for feature labels — see features/terrain.ts) =====================
// These collapse the 31 land zones into the coarse kinds the label detector names, so labels read off the
// SAME Köppen truth as the colours (no second biome classifier). Mountains stay elevation-driven (Köppen
// is climate-only), so there's deliberately no "mountain" zone here.

/** Ocean (the three depth bands) — not a land biome. */
export const isOceanZone = (zone: number): boolean => Math.round(zone) <= KZ.OCEAN_SHALLOW;

/** Arid B climates (hot/cold deserts + steppes) — the "desert" feature-label kind. */
export function isAridZone(zone: number): boolean {
  const z = Math.round(zone);
  return z === KZ.BWh || z === KZ.BWk || z === KZ.BSh || z === KZ.BSk;
}

/** Forested climates: tropical wet (Af, Am), humid temperate (Cf, Cw) and humid + boreal continental
 *  (Df, Dw — incl. taiga). Savanna (Aw, As), mediterranean (Cs, Ds), steppe, tundra and ice are NOT forest. */
export function isForestZone(zone: number): boolean {
  const z = Math.round(zone);
  return (
    z === KZ.Af || z === KZ.Am ||
    (z >= KZ.Cwa && z <= KZ.Cfc) || // Cwa..Cwc, Cfa..Cfc
    (z >= KZ.Dwa && z <= KZ.Dfd) // Dwa..Dwd, Dfa..Dfd
  );
}
