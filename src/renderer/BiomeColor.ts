import {
  BASE_LIGHTNESS,
  BiomeColors,
  LAND_FAMILY_STOPS,
  MOISTURE_STOPS,
  THEME_OVERRIDES,
  bandLightnessAt,
  colorFor as baseColorFor,
  type ElevationBand,
  type ElevationFamily,
  type MoistureBand,
  type Theme,
} from "../common/biomes";
import {
  hexToHsl,
  hexToRgb,
  hslToHex,
  internPalette,
  invertHex,
  mixHex,
  quantizeColor,
} from "../common/colorUtils";
import { KOPPEN_COLORS, KOPPEN_RGB, KOPPEN_ZONE_COUNT } from "../common/koppen";
import type { GlobeMap } from "../common/map";
import { CONTINENTS, FEATURES, OCEANS } from "../common/settings";
import { applyContrast, clamp } from "../common/util";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
const EPSILON = 1e-9;
const EXP_CURVE_K = 4.1;
const RAINFALL_MIN = 0.01;
const RAINFALL_SCALE = 25;

/** ================================================
 *  Helpers
 *  ================================================ */
function expCurve(x: number, k: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
}

function shapeForRules(
  elevation: number,
  moisture: number,
  rainfall: number
): { elevation: number; moisture: number } {
  // The waterline split, in CONTRASTED space (the `elevation` passed in is already contrasted).
  // applyContrast is monotonic, so contrasted-e < applyContrast(WATERLINE) ⟺ raw-e < WATERLINE — the
  // SAME split generation made; thresholding against the RAW waterline only matched while WATERLINE ≈
  // the 0.5 contrast pivot, so lowering it painted generator-made land as ocean. Below → ocean depth
  // [-1,0], above → land height [0,1] — so land keeps its full band range.
  const waterline = applyContrast(OCEANS.SEA_LEVEL.value, CONTINENTS.ELEVATION_CONTRAST.value);
  let e =
    elevation < waterline
      ? elevation / Math.max(waterline, EPSILON) - 1
      : (elevation - waterline) / Math.max(1 - waterline, EPSILON);

  let m = Math.pow(moisture, rainfall);

  e = Math.max(Math.min(e, 1 - EPSILON), -1);
  m = Math.max(Math.min(m, 1 - EPSILON), 0);
  return { elevation: e, moisture: m };
}

const nearestStop = <T extends { center: number }>(stops: T[], x: number): T =>
  stops.reduce((best, s) => (Math.abs(s.center - x) < Math.abs(best.center - x) ? s : best));

/**
 * The discrete biome of a cell — the elevation family + moisture band the colour pipeline lands on —
 * computed with the SAME shaping as colorAt, so it matches what's drawn. Returns null for ocean.
 * Feature labelling uses this to find deserts / forests / mountain ranges; pure given the live dials.
 */
export function terrainClassOf(
  rawElevation: number,
  moisture: number,
  rainfall: number
): { family: ElevationFamily; band: MoistureBand } | null {
  if (rawElevation < OCEANS.SEA_LEVEL.value) return null; // ocean — same waterline split as generation
  const shapedRain = Math.max(RAINFALL_MIN, expCurve(1 - rainfall, EXP_CURVE_K) * RAINFALL_SCALE);
  const { elevation: e, moisture: m } = shapeForRules(
    applyContrast(rawElevation, CONTINENTS.ELEVATION_CONTRAST.value),
    moisture,
    shapedRain
  );
  return {
    family: nearestStop(LAND_FAMILY_STOPS, e).family,
    band: nearestStop(MOISTURE_STOPS, m).band,
  };
}

/** ================================================
 *  One-stop mapper
 *  ================================================ */
export function colorAt(
  theme: Theme,
  elevation: number,
  moisture: number,
  rainfall: number
): string {
  if (rainfall < 0 || rainfall > 1) {
    throw Error("rainfall must be 0-1");
  }

  const shaped = expCurve(1 - rainfall, EXP_CURVE_K);
  rainfall = Math.max(RAINFALL_MIN, shaped * RAINFALL_SCALE);

  const { elevation: e, moisture: m } = shapeForRules(elevation, moisture, rainfall);

  // Grab the climate (biome) colour for this cell — BUT when climate is off (no moisture swing),
  // land/ice instead take the INVERSE of the sea colour. Then continue as normal: the elevation-band
  // lightness + saturation + quantize below (and hillshade at draw time) modulate it, so inverse-of-
  // sea land still reads its relief. Ocean always keeps its own (depth-shaded) colour.
  const climateOff = !FEATURES.climate;
  const baseHex =
    climateOff && e >= 0
      ? invertHex(BiomeColors[theme].OCEAN)
      : baseColorFor(theme, e, m);
  const { h, s, l } = hexToHsl(baseHex);

  const adj = resolveTheme(theme);
  const s2 = clamp(s * (adj.saturationScale ?? 1));
  // Continuous (interpolated) band-lightness nudge — no hard step at band breaks (see biomes.ts).
  const delta = bandLightnessAt(e, adj.lightness);
  const l2 = clamp(l + delta);
  // Quantize so the blend stays smooth-ish but the total palette stays small.
  return quantizeColor(hslToHex(h, s2, l2));
}

/** ================================================
 *  Per-cell colours (shared by every renderer)
 *  ================================================ */
// Per-cell base colour as an index into a small deduplicated palette, so a renderer
// resolves each distinct colour once instead of once per cell. Both the Canvas2D and
// the WebGL renderer build their fills from this, so they stay pixel-identical.
export type CellColors = { palette: string[]; colorIdx: Int32Array };

/** The choropleth's source data, threaded to the WebGL renderer so it can bake + sample the country
 *  texture (see countryTexture.ts) — which lets the tint follow onto detail patches at any zoom. The
 *  base map is needed for its cell sites during the bake. */
export type ChoroplethTint = {
  map: GlobeMap; // the BASE map (countryOf / sites index into it)
  countryOf: Int32Array; // per base cell: country index, or -1 for ocean / water
  countryColors: Int32Array; // per country index: choropleth colour class
  key: string; // identity for the renderer's texture cache (changes with the data + toggle)
};

export function computeCellColors(map: GlobeMap, theme: Theme, viewPlates: boolean): CellColors {
  const { koppenZone, cellCount } = map;
  const colors = computeColorsFromFields(koppenZone, cellCount, theme);
  if (!viewPlates) return colors;

  // Plate overlay ON: tint each cell's biome colour with its plate's color at PLATE_OVERLAY_OPACITY.
  const plateColors = computePlateColors(map);
  return internPalette(cellCount, (i) =>
    quantizeColor(
      mixHex(
        colors.palette[colors.colorIdx[i]],
        plateColors.palette[plateColors.colorIdx[i]],
        PLATE_OVERLAY_OPACITY
      )
    )
  );
}

/** ================================================
 *  Tectonic-plate overlay (the "tectonic plates" toggle)
 *  ================================================ */
// A stable, distinct colour per plate id: golden-angle hue rotation so neighbouring ids land on
// well-separated hues.
const PLATE_HUE_STEP = 137.508; // golden angle, degrees
const PLATE_OVERLAY_OPACITY = 0.5; // plate tint strength over the biome colour when viewPlates is on
function plateColor(plateId: number): string {
  return hslToHex((plateId * PLATE_HUE_STEP) % 360, 0.6, 0.55);
}

/** Per-cell colours for the plate overlay: each cell takes its plate's colour, interned into a
 *  small palette (one entry per plate). Blended over the biome colours at PLATE_OVERLAY_OPACITY
 *  when viewPlates is on (see computeCellColors). */
export function computePlateColors(map: GlobeMap): CellColors {
  const { plate, cellCount } = map;
  return internPalette(cellCount, (i) => plateColor(plate[i]));
}

/**
 * Per-cell colours from the baked Köppen zone field: the renderer just looks each zone's colour up in
 * the earth palette (KOPPEN_COLORS). The classifier ran in the FIELD (ElevationCalculator / its GPU twin),
 * so colouring is now a pure table lookup — byte-identical to the GPU patch shader's palette read.
 * Decoupled from GlobeMap so the cubemap baker can reuse it over flat field arrays.
 */
export function computeColorsFromFields(
  koppenZone: Float32Array,
  count: number,
  theme: Theme
): CellColors {
  return internPalette(count, (i) => koppenColorHex(koppenZone[i], theme));
}

/** A Köppen zone's earth-palette colour, with the active theme's saturation applied (so grayscale et al.
 *  still tint the land). The palette is theme-independent (one earth palette); themes only scale saturation
 *  for now — per-theme Köppen palettes are a follow-up. */
export function koppenColorHex(zone: number, theme: Theme): string {
  const hex = KOPPEN_COLORS[Math.round(zone)] ?? KOPPEN_COLORS[0];
  const sat = resolveTheme(theme).saturationScale ?? 1;
  if (sat === 1) return hex;
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, clamp(s * sat), l);
}

/** The Köppen palette as a flat RGB Float32Array (zone*3 → r,g,b in 0..1) for the GPU patch shader's
 *  `uPalette` uniform — theme-adjusted to match koppenColorHex exactly (base mesh ≡ GPU patches). */
export function koppenPaletteRgb(theme: Theme): Float32Array {
  const sat = resolveTheme(theme).saturationScale ?? 1;
  if (sat === 1) return KOPPEN_RGB;
  const out = new Float32Array(KOPPEN_ZONE_COUNT * 3);
  for (let z = 0; z < KOPPEN_ZONE_COUNT; z++) {
    const rgb = hexToRgb(koppenColorHex(z, theme)) ?? { r: 255, g: 0, b: 255 };
    out[3 * z] = rgb.r / 255;
    out[3 * z + 1] = rgb.g / 255;
    out[3 * z + 2] = rgb.b / 255;
  }
  return out;
}

/** ================================================
 *  Theme helpers
 *  ================================================ */
// Theme adjustments are constant per theme, but colorAt runs per cell — cache the
// resolved object so each cell doesn't rebuild a fresh lightness map (alloc churn).
const resolvedThemeCache = new Map<
  Theme,
  { lightness: Record<ElevationBand, number>; saturationScale: number }
>();
function resolveTheme(theme: Theme) {
  const cached = resolvedThemeCache.get(theme);
  if (cached) return cached;
  const o = THEME_OVERRIDES[theme] ?? {};
  const lightness: Record<ElevationBand, number> = {
    ...BASE_LIGHTNESS,
    ...(o.lightness ?? {}),
  };
  const resolved = { lightness, saturationScale: o.saturationScale ?? 1.0 };
  resolvedThemeCache.set(theme, resolved);
  return resolved;
}
