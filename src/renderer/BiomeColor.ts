import {
  BASE_LIGHTNESS,
  THEME_OVERRIDES,
  colorFor as baseColorFor,
  getElevationBandNameRaw, // now backed by the unified thresholds
  type ElevationBand,
  type Theme,
} from "../common/biomes"; // fast (theme, elevation, moisture) -> hex
import { clamp, lerp } from "../common/util";

const EPS = 1e-9;

function expCurve(x: number, k: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
}

/** Internal: apply sea level shift & rainfall exponent */
function shapeForRules(
  elevation: number,
  moisture: number,
  rainfall: number,
  seaLevel: number
): { elevation: number; moisture: number } {
  // map elevation 0..1 -> [-1..1], then shift by sea level (lower sea => more land)
  let e = lerp(-0.9 - (seaLevel - 0.1), 0.9 - (seaLevel - 0.1), elevation);

  // moisture exponent
  let m = Math.pow(moisture, rainfall);

  // clamp to rule space
  e = Math.max(Math.min(e, 1 - EPS), -1);
  m = Math.max(Math.min(m, 1 - EPS), 0); // [0..1]
  return { elevation: e, moisture: m };
}

/** One-stop: elevation+moisture -> themed color (fast mapper + theme shading) */
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

  // Moisture shaping (same feel as before)
  const shaped = expCurve(1 - rainfall, 4.1);
  rainfall = Math.max(0.01, shaped * 25);
  // Normalize sea level to -1..1
  seaLevel = 2.0 * (seaLevel - 0.5);

  const { elevation: e, moisture: m } = shapeForRules(elevation, moisture, rainfall, seaLevel);

  // 1) Base color from fast lookup (uses shaped e/m)
  const baseHex = baseColorFor(theme, e, m);

  // 2) Apply theme adjustments using elevation band (including ocean depth bands)
  const eBand = getElevationBandNameRaw(e);
  const { h, s, l } = hexToHsl(baseHex);

  const adj = resolveTheme(theme);
  const s2 = clamp(s * (adj.saturationScale ?? 1));
  const delta = adj.lightness[eBand.band] ?? 0;
  const l2 = clamp(l + delta);
  return hslToHex(h, s2, l2);
}

/** ===================== Local banding for shading (raw elevation only) ===================== */

function resolveTheme(theme: Theme) {
  const o = THEME_OVERRIDES[theme] ?? {};
  const lightness: Record<ElevationBand, number> = {
    ...BASE_LIGHTNESS,
    ...(o.lightness ?? {}),
  };
  const saturationScale = o.saturationScale ?? 1.0;
  return { lightness, saturationScale };
}

/** ===================== Hex/HSL utils ===================== */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
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
    h *= 60;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (0 <= h && h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (60 <= h && h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (120 <= h && h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (180 <= h && h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (240 <= h && h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
