import { synthesizeClimateAtPoint } from "../mapgen/climate/climateSynthesis";
import type { ClimateWorldSampler } from "../mapgen/climate/types";
import type { Vec3 } from "./3DMath";
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

export const KOPPEN_ZONE_COUNT = Object.keys(KZ).length;

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
// This is climate-generation, not Köppen definition. Keep the real classification thresholds in KOPPEN.
// Sea-level MAT by |latitude|: ~27 °C at the equator falling to deep polar cold. Elevation cools via the
// environmental lapse rate. Callers should pass REPORT elevation for ordinary climate, because rendered
// elevation deliberately includes cartographic mountain relief/caps.
export const MAT_EQUATOR_C = 27;
export const MAT_POLE_C = -25;
export const LATITUDE_FALLOFF = 1.4;
export const LAPSE_C_PER_M = 0.0065;
export const EVEREST_M = 8849;

/** A cell's mean annual temperature in °C, from latitude and lapse-rate-cooled elevation. */
export function meanAnnualTempC(latDeg: number, displayElevation: number, seaLevel: number): number {
  const a = Math.min(1, Math.abs(latDeg) / 90);
  const sealevelMat = MAT_EQUATOR_C - (MAT_EQUATOR_C - MAT_POLE_C) * a ** LATITUDE_FALLOFF;
  const frac = Math.max(0, (displayElevation - seaLevel) / Math.max(1 - seaLevel, 1e-6));
  return sealevelMat - LAPSE_C_PER_M * frac * EVEREST_M;
}

// ===================== Synthetic Earth-like climate generation =====================
// These are tunable generator knobs. They are NOT Köppen thresholds. Exported because the GLSL
// twin's constant block is GENERATED from this object (koppen.glsl.ts) — edit here, both realms move.
export const EARTH_CLIMATE = {
  PRECIP_MAX_MM: 3200,
  // Below 2.0 on purpose: the moisture field has already been maritime-boosted and interior-dried upstream.
  // A heavier exponent makes too much mid-latitude land fail B before it can become C/D.
  PRECIP_MOISTURE_EXPONENT: 1.75,
  HADLEY_DRY_FLOOR: 0.28,
  HADLEY_STORM_TRACK_WEIGHT: 0.7,
  COASTAL_PRECIP_BOOST: 1.08,
  INTERIOR_PRECIP_FACTOR: 0.9,
  DRY_SEASON_STRENGTH: 0.58,
  WET_SEASON_STRENGTH: 0.62,
  WEAK_SEASONAL_PRECIP_STRENGTH: 0.18,
  MEDITERRANEAN_LAT_MIN: 28,
  MEDITERRANEAN_LAT_MAX: 45,
  MEDITERRANEAN_MOISTURE_MIN: 0.25,
  MEDITERRANEAN_MOISTURE_MAX: 0.68,
  MEDITERRANEAN_MAX_CONTINENTALITY: 0.5,
  MONSOON_LAT_MAX: 28,
  MONSOON_MOISTURE_MAX: 0.62,
} as const;

// ===================== Locked Köppen constants =====================
// These are the classification rules. Avoid tuning these for visual distribution; tune EARTH_CLIMATE
// instead. Exported: the GLSL twin's K_* constant block is GENERATED from this object.
export const KOPPEN = {
  ARIDITY_TEMP_MULTIPLIER: 2, // pth = this × mean annual temp + seasonal offset (mm)
  TROPICAL_COLD_MONTH_MIN_C: 18,
  POLAR_WARM_MONTH_MAX_C: 2,
  ICE_CAP_WARM_MONTH_MAX_C: 0,
  TREE_MONTH_MIN_C: 10,
  TEMPERATE_COLD_MONTH_MIN_C: -3,
  ARID_HOT_MEAN_ANNUAL_C: 18,
  HOT_SUMMER_WARM_MONTH_MIN_C: 22,
  WARM_MONTHS_FOR_B: 4,
  EXTREME_COLD_WINTER_C: -38,
  AF_DRIEST_MONTH_MIN_MM: 60,
  AM_DRIEST_MONTH_BASE_MM: 100,
  AM_DRIEST_MONTH_ANNUAL_DIVISOR: 25,
  DRY_SUMMER_MAX_DRIEST_SUMMER_MM: 40,
  DRY_SUMMER_WINTER_RATIO: 3,
  DRY_WINTER_SUMMER_RATIO: 10,
  ARID_SUMMER_DRY_OFFSET_MM: 28,
  ARID_EVEN_OFFSET_MM: 14,
  ARID_WINTER_DRY_OFFSET_MM: 0,
} as const;

// ===================== Terrain override constants =====================
// Highland is deliberately outside real Köppen. It is a terrain/color override for rendered mountains.
// Exported: the GLSL twin's HIGHLAND_* constant block is GENERATED from this object.
export const HIGHLAND = {
  MOUNTAIN_LAND_E: 0.18,
  PERENNIAL_SNOW_TWARM_C: -8,
  BARE_ROCK_TWARM_C: 3,
} as const;

/** `lat0to1` = |lat|/90; `continentality` ∈ [0,1] = how deep in a landmass interior the cell sits. */
export function seasonalAmplitudeC(
  lat0to1: number,
  continentality: number,
  base: number,
  continentalWeight: number
): number {
  // Latitude shape: temperature seasonality is weak in the tropics and strong toward high latitudes.
  const latShape = lat0to1 * lat0to1;
  return base * latShape * (1 + continentalWeight * continentality);
}

/** Annual precipitation in mm from the procedural moisture field. */
export function moistureToPrecipMm(moisture: number): number {
  const m = Math.max(0, Math.min(1, moisture));
  return m ** EARTH_CLIMATE.PRECIP_MOISTURE_EXPONENT * EARTH_CLIMATE.PRECIP_MAX_MM;
}

const gauss1 = (x: number, mu: number, sigma: number): number =>
  Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/** Earth-like zonal rain bands: wet equator, dry subtropics, wetter storm tracks. */
export function hadleyPrecipFactor(absLatDeg: number, strength: number): number {
  const itcz = gauss1(absLatDeg, 0, 13);
  const stormTrack = EARTH_CLIMATE.HADLEY_STORM_TRACK_WEIGHT * gauss1(absLatDeg, 50, 18);
  const shaped = EARTH_CLIMATE.HADLEY_DRY_FLOOR + (1 - EARTH_CLIMATE.HADLEY_DRY_FLOOR) * Math.max(itcz, stormTrack);
  return 1 + strength * (shaped - 1);
}

type SyntheticClimate = {
  tempsC: number[];
  precipMm: number[];
  annualPrecipMm: number;
  warmestMonthC: number;
  coldestMonthC: number;
  meanAnnualTempC: number;
  driestMonthMm: number;
  driestSummerMonthMm: number;
  driestWinterMonthMm: number;
  wettestSummerMonthMm: number;
  wettestWinterMonthMm: number;
  monthsAbove10C: number;
};

function aridityThresholdMm(c: SyntheticClimate): number {
  const summerPrecip = c.precipMm.slice(0, 6).reduce((a, b) => a + b, 0);
  const winterPrecip = c.precipMm.slice(6).reduce((a, b) => a + b, 0);
  const summerShare = c.annualPrecipMm <= 0 ? 0 : summerPrecip / c.annualPrecipMm;
  const winterShare = c.annualPrecipMm <= 0 ? 0 : winterPrecip / c.annualPrecipMm;
  const offset =
    summerShare >= 0.7
      ? KOPPEN.ARID_WINTER_DRY_OFFSET_MM
      : winterShare >= 0.7
        ? KOPPEN.ARID_SUMMER_DRY_OFFSET_MM
        : KOPPEN.ARID_EVEN_OFFSET_MM;
  return Math.max(0, KOPPEN.ARIDITY_TEMP_MULTIPLIER * c.meanAnnualTempC + offset);
}

function seasonalDrynessLetter(c: SyntheticClimate): number {
  // 1=s, 2=w, 0=f, using Köppen dry-summer/dry-winter precipitation ratios.
  const drySummer =
    c.driestSummerMonthMm < KOPPEN.DRY_SUMMER_MAX_DRIEST_SUMMER_MM &&
    c.driestSummerMonthMm * KOPPEN.DRY_SUMMER_WINTER_RATIO < c.wettestWinterMonthMm;
  if (drySummer) return 1;

  const dryWinter = c.driestWinterMonthMm * KOPPEN.DRY_WINTER_SUMMER_RATIO < c.wettestSummerMonthMm;
  if (dryWinter) return 2;

  return 0;
}

function heatLetter(c: SyntheticClimate): number {
  // 0: hot summer
  // 1: warm summer
  if (c.warmestMonthC >= KOPPEN.HOT_SUMMER_WARM_MONTH_MIN_C) return 0; // a
  if (c.monthsAbove10C >= KOPPEN.WARM_MONTHS_FOR_B) return 1; // b
  if (c.coldestMonthC <= KOPPEN.EXTREME_COLD_WINTER_C) return 3; // d
  return 2; // c
}

export const isWater = (elevation: number, seaLevel: number): boolean => elevation < seaLevel;

// Ocean depth bands across [0, seaLevel] (fraction of the waterline). Exported: the GLSL twin's
// OCEAN_* constant block is GENERATED from this object.
export const OCEAN_DEPTH_BANDS = {
  DEEP_MAX_FRAC: 0.34,
  MID_MAX_FRAC: 0.7,
} as const;

/**
 * Classify one cell into a Köppen zone index (KZ.*). The API remains scalar for CPU/GPU callers, but the
 * classifier immediately reconstructs a synthetic 12-month climate and applies locked Köppen rules to it.
 *
 * `elevation` here should be rendered elevation for water/depth + highland terrain override. Temperature
 * should already have been computed from report elevation upstream when calling meanAnnualTempC.
 */
export function classifyKoppen(args: {
  site: Vec3;

  latDeg: number;
  lonDeg: number;

  /** Rendered normalized elevation for ocean/depth bands + highland terrain override. */
  elevation: number;

  /** Climate (report) elevation in meters above sea level, for the lapse rate. */
  elevationM: number;

  seaLevel: number;

  /** Terrain access at arbitrary sphere points — upwind ocean fetch + rain-shadow barriers. */
  world: ClimateWorldSampler;
}): number {
  const {
    site,
    latDeg,
    lonDeg,
    elevation,
    elevationM,
    seaLevel,
    world,
  } = args;

  // --- ocean: three depth bands across [0, seaLevel] ---
  if (isWater(elevation, seaLevel)) {
    const d = elevation / Math.max(seaLevel, 1e-6);
    if (d < OCEAN_DEPTH_BANDS.DEEP_MAX_FRAC) return KZ.OCEAN_DEEP;
    if (d < OCEAN_DEPTH_BANDS.MID_MAX_FRAC) return KZ.OCEAN_MID;
    return KZ.OCEAN_SHALLOW;
  }

  const climate = synthesizeClimateAtPoint({
    x: site.x,
    y: site.y,
    z: site.z,
    latDeg,
    lonDeg,
    elevationM,
    isOcean: false,
    seaLevel,
    world,
  });

  // --- Highland terrain override. Not part of real Köppen; kept as your mountain colour ramp. ---
  const landE = (elevation - seaLevel) / Math.max(1 - seaLevel, 1e-6);
  if (landE > HIGHLAND.MOUNTAIN_LAND_E) {
    if (climate.warmestMonthC < HIGHLAND.PERENNIAL_SNOW_TWARM_C) return KZ.EF;
    if (climate.warmestMonthC < HIGHLAND.BARE_ROCK_TWARM_C) return KZ.BARE;
    return KZ.ALPINE;
  }

  // --- E: polar ---
  if (climate.warmestMonthC <= KOPPEN.ICE_CAP_WARM_MONTH_MAX_C) return KZ.EF;
  if (climate.warmestMonthC < KOPPEN.POLAR_WARM_MONTH_MAX_C) return KZ.ET;

  // --- B: arid ---
  const pth = aridityThresholdMm(climate);
  if (climate.annualPrecipMm < pth) {
    const hot = climate.meanAnnualTempC >= KOPPEN.ARID_HOT_MEAN_ANNUAL_C;
    if (climate.annualPrecipMm < 0.5 * pth) return hot ? KZ.BWh : KZ.BWk;
    return hot ? KZ.BSh : KZ.BSk;
  }

  // --- A: tropical ---
  if (climate.coldestMonthC >= KOPPEN.TROPICAL_COLD_MONTH_MIN_C) {
    if (climate.driestMonthMm >= KOPPEN.AF_DRIEST_MONTH_MIN_MM) return KZ.Af;

    const monsoonCutoff =
      KOPPEN.AM_DRIEST_MONTH_BASE_MM -
      climate.annualPrecipMm / KOPPEN.AM_DRIEST_MONTH_ANNUAL_DIVISOR;

    if (climate.driestMonthMm >= monsoonCutoff) return KZ.Am;
    return climate.driestSummerMonthMm < climate.driestWinterMonthMm ? KZ.As : KZ.Aw;
  }

  // --- C / D: temperate / continental ---
  const dry = seasonalDrynessLetter(climate);
  const heat = heatLetter(climate);
  const h = Math.min(heat, 2); // C climates only use a/b/c.

  if (climate.coldestMonthC > KOPPEN.TEMPERATE_COLD_MONTH_MIN_C) {
    if (dry === 1) return KZ.Csa + h;
    if (dry === 2) return KZ.Cwa + h;
    return KZ.Cfa + h;
  }

  if (dry === 1) return KZ.Dsa + heat;
  if (dry === 2) return KZ.Dwa + heat;
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
