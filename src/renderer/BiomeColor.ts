import {
  BASE_LIGHTNESS,
  THEME_OVERRIDES,
  colorFor as baseColorFor,
  getElevationBandNameRaw,
  type ElevationBand,
  type Theme,
} from "../common/biomes";
import { clamp, lerp } from "../common/util";
import { hexToHsl, hslToHex } from "../common/colorUtils";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
const EPSILON = 1e-9;
const EXP_CURVE_K = 4.1;
const RAINFALL_MIN = 0.01;
const RAINFALL_SCALE = 25;
const SEA_LEVEL_SHIFT = 0.5;
const SEA_LEVEL_RANGE_SCALE = 2.0;
const ELEVATION_LERP_MIN = -0.9;
const ELEVATION_LERP_MAX = 0.9;
const ELEVATION_SHIFT_BASE = 0.1;

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
  rainfall: number,
  seaLevel: number
): { elevation: number; moisture: number } {
  let e = lerp(
    ELEVATION_LERP_MIN - (seaLevel - ELEVATION_SHIFT_BASE),
    ELEVATION_LERP_MAX - (seaLevel - ELEVATION_SHIFT_BASE),
    elevation
  );

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
  rainfall: number,
  seaLevel: number
): string {
  if (rainfall < 0 || rainfall > 1 || seaLevel < 0 || seaLevel > 1) {
    throw Error("rainfall & seaLevel must be 0-1");
  }

  const shaped = expCurve(1 - rainfall, EXP_CURVE_K);
  rainfall = Math.max(RAINFALL_MIN, shaped * RAINFALL_SCALE);
  seaLevel = SEA_LEVEL_RANGE_SCALE * (seaLevel - SEA_LEVEL_SHIFT);

  const { elevation: e, moisture: m } = shapeForRules(
    elevation,
    moisture,
    rainfall,
    seaLevel
  );

  const baseHex = baseColorFor(theme, e, m);
  const eBand = getElevationBandNameRaw(e);
  const { h, s, l } = hexToHsl(baseHex);

  const adj = resolveTheme(theme);
  const s2 = clamp(s * (adj.saturationScale ?? 1));
  const delta = adj.lightness[eBand.band] ?? 0;
  const l2 = clamp(l + delta);
  return hslToHex(h, s2, l2);
}

/** ================================================
 *  Theme helpers
 *  ================================================ */
function resolveTheme(theme: Theme) {
  const o = THEME_OVERRIDES[theme] ?? {};
  const lightness: Record<ElevationBand, number> = {
    ...BASE_LIGHTNESS,
    ...(o.lightness ?? {}),
  };
  const saturationScale = o.saturationScale ?? 1.0;
  return { lightness, saturationScale };
}
