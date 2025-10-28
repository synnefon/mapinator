import {
  BASE_LIGHTNESS,
  THEME_OVERRIDES,
  colorFor as baseColorFor,
  getElevationBandNameRaw,
  type ElevationBand,
  type Theme,
} from "../common/biomes";
import { clamp, lerp } from "../common/util";

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
const HUE_ROTATION_SEGMENTS = 60;
const RGB_MAX = 255;

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

/** ================================================
 *  Hex / HSL utils
 *  ================================================ */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let c = hex.replace("#", "");
  if (c.length === 3) {
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const r = parseInt(c.slice(0, 2), 16) / RGB_MAX;
  const g = parseInt(c.slice(2, 4), 16) / RGB_MAX;
  const b = parseInt(c.slice(4, 6), 16) / RGB_MAX;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= HUE_ROTATION_SEGMENTS;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / HUE_ROTATION_SEGMENTS) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) {
    r = c;
    g = x;
  } else if (60 <= h && h < 120) {
    r = x;
    g = c;
  } else if (120 <= h && h < 180) {
    g = c;
    b = x;
  } else if (180 <= h && h < 240) {
    g = x;
    b = c;
  } else if (240 <= h && h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (v: number) =>
    Math.round((v + m) * RGB_MAX)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
