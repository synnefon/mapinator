import {
  BASE_LIGHTNESS,
  THEME_OVERRIDES,
  colorFor as baseColorFor,
  getElevationBandNameRaw,
  iceColorFor,
  type ElevationBand,
  type Theme,
} from "../common/biomes";
import { hexToHsl, hslToHex, mixHex, quantizeColor } from "../common/colorUtils";
import type { GlobeMap } from "../common/map";
import { COAST, CONTINENT } from "../common/settings";
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
  // Fixed waterline in raw-elevation space: below it renormalizes to ocean depth
  // [-1,0], above it to land height [0,1] — so land keeps its full band range.
  const waterline = COAST.WATERLINE;
  let e =
    elevation < waterline
      ? elevation / Math.max(waterline, EPSILON) - 1
      : (elevation - waterline) / Math.max(1 - waterline, EPSILON);

  let m = Math.pow(moisture, rainfall);

  e = Math.max(Math.min(e, 1 - EPSILON), -1);
  m = Math.max(Math.min(m, 1 - EPSILON), 0);
  return { elevation: e, moisture: m };
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

  const baseHex = baseColorFor(theme, e, m);
  const eBand = getElevationBandNameRaw(e);
  const { h, s, l } = hexToHsl(baseHex);

  const adj = resolveTheme(theme);
  const s2 = clamp(s * (adj.saturationScale ?? 1));
  const delta = adj.lightness[eBand.band] ?? 0;
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

export function computeCellColors(map: GlobeMap, theme: Theme): CellColors {
  const { elevation, moisture, ice, cellCount, rainfall } = map;
  return computeColorsFromFields(
    elevation,
    moisture,
    ice,
    rainfall,
    cellCount,
    theme
  );
}

/**
 * Core of computeCellColors, decoupled from GlobeMap so the cubemap baker can reuse
 * the exact same biome/ice/quantize logic over flat field arrays (texels, not cells).
 */
export function computeColorsFromFields(
  elevation: Float32Array,
  moisture: Float32Array,
  ice: Float32Array,
  rainfall: number,
  count: number,
  theme: Theme
): CellColors {
  const iceColor = iceColorFor(theme); // matches this theme's snowiest peak
  const colorIdx = new Int32Array(count);
  const palette: string[] = [];
  const indexOf = new Map<string, number>();
  const intern = (hex: string): number => {
    let idx = indexOf.get(hex);
    if (idx === undefined) {
      idx = palette.length;
      palette.push(hex);
      indexOf.set(hex, idx);
    }
    return idx;
  };

  for (let i = 0; i < count; i++) {
    const biome = colorAt(
      theme,
      applyContrast(elevation[i], CONTINENT.ELEVATION_CONTRAST),
      moisture[i],
      rainfall
    );
    // Blend snow into the terrain by iciness (quantized to keep the palette small), so
    // the ice edge fades like every other biome instead of being a flat sticker.
    const hex =
      ice[i] > 0 ? quantizeColor(mixHex(biome, iceColor, ice[i])) : biome;
    colorIdx[i] = intern(hex);
  }
  return { palette, colorIdx };
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
