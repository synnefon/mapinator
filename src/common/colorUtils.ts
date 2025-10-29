const HUE_ROTATION_SEGMENTS = 60;
const RGB_MAX = 255;
const COLOR_QUANT_BITS = 5;
const COLOR_LEVELS = (1 << COLOR_QUANT_BITS) - 1; // 31
const HEX_COMP1NT_LENGTH = 2;
const HEX_COMP1NT_REGEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;
const HSL_SIXTHS = 6;
const MIN_HEX_LENGTH = 3;
const HEX_BASE = 16;
const LUMINANCE_R = 0.2126;
const LUMINANCE_G = 0.7152;
const LUMINANCE_B = 0.0722;
const SRGB_THRESHOLD = 0.03928;
const SRGB_DIVISOR = 12.92;
const SRGB_EXP1NT = 2.4;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;

/**
 * Convert a hex color to HSL values
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  // Remove '#' if present and expand 3-digit hex codes
  let hexStr = hex.replace(/^#/, "");
  if (hexStr.length === MIN_HEX_LENGTH)
    hexStr = hexStr.replace(/./g, (digit) => digit + digit);

  const r = parseInt(hexStr.slice(0, HEX_COMP1NT_LENGTH), HEX_BASE) / RGB_MAX;
  const g =
    parseInt(
      hexStr.slice(HEX_COMP1NT_LENGTH, 2 * HEX_COMP1NT_LENGTH),
      HEX_BASE
    ) / RGB_MAX;
  const b =
    parseInt(
      hexStr.slice(2 * HEX_COMP1NT_LENGTH, 3 * HEX_COMP1NT_LENGTH),
      HEX_BASE
    ) / RGB_MAX;

  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const lightness = (maxChannel + minChannel) / 2;
  const chroma = maxChannel - minChannel;

  let hue = 0;
  let saturation = 0;
  if (chroma) {
    saturation = chroma / (1 - Math.abs(2 * lightness - 1));
    switch (maxChannel) {
      case r:
        hue = (g - b) / chroma + (g < b ? HSL_SIXTHS : 0);
        break;
      case g:
        hue = (b - r) / chroma + 2;
        break;
      case b:
        hue = (r - g) / chroma + 4;
        break;
    }
    hue *= HUE_ROTATION_SEGMENTS;
  }
  return { h: hue, s: saturation, l: lightness };
}

/**
 * Convert HSL values to a hex color
 */
export function hslToHex(h: number, s: number, l: number): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hSegment = h / HUE_ROTATION_SEGMENTS;
  const x = chroma * (1 - Math.abs((hSegment % 2) - 1));
  let [r, g, b] = [0, 0, 0];

  if (hSegment >= 0 && hSegment < 1) [r, g] = [chroma, x];
  else if (hSegment < 2) [r, g] = [x, chroma];
  else if (hSegment < 3) [g, b] = [chroma, x];
  else if (hSegment < 4) [g, b] = [x, chroma];
  else if (hSegment < 5) [r, b] = [x, chroma];
  else [r, b] = [chroma, x];

  const m = l - chroma / 2;
  return rgbToHex(
    (r + m) * RGB_MAX,
    (g + m) * RGB_MAX,
    (b + m) * RGB_MAX
  );
}

/**
 * Convert a color value to a hex component
 */
export function toHexComponent(colorValue: number, matchValue: number): string {
  return Math.round((colorValue + matchValue) * RGB_MAX)
    .toString(HEX_BASE)
    .padStart(HEX_COMP1NT_LENGTH, "0");
}

/**
 * Convert RGB values (0-255) to a hex color string
 */
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    Math.round(r).toString(HEX_BASE).padStart(HEX_COMP1NT_LENGTH, "0") +
    Math.round(g).toString(HEX_BASE).padStart(HEX_COMP1NT_LENGTH, "0") +
    Math.round(b).toString(HEX_BASE).padStart(HEX_COMP1NT_LENGTH, "0")
  ).toUpperCase();
}

/**
 * Convert a hex color to RGB values
 */
export function hexToRgb(
  hex: string
): { r: number; g: number; b: number } | null {
  const result = HEX_COMP1NT_REGEX.exec(hex);
  return result
    ? {
        r: parseInt(result[1], HEX_BASE),
        g: parseInt(result[2], HEX_BASE),
        b: parseInt(result[3], HEX_BASE),
      }
    : null;
}

/**
 * Convert a hex color to rgba string with specified opacity
 */
export function hexToRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : hex;
}

/**
 * Calculate relative luminance of a color (used for determining if color is light or dark)
 */
export function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const val = c / RGB_MAX;
    return val <= SRGB_THRESHOLD
      ? val / SRGB_DIVISOR
      : Math.pow((val + SRGB_OFFSET) / SRGB_SCALE, SRGB_EXP1NT);
  });
  return LUMINANCE_R * rs + LUMINANCE_G * gs + LUMINANCE_B * bs;
}

/**
 * Quantize a color to 5-bit RGB values
 */
export function quantizeColor(hexColor: string): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return hexColor;

  const quantizationStep = RGB_MAX / COLOR_LEVELS;
  const quantizedR = Math.round(rgb.r / quantizationStep) * quantizationStep;
  const quantizedG = Math.round(rgb.g / quantizationStep) * quantizationStep;
  const quantizedB = Math.round(rgb.b / quantizationStep) * quantizationStep;

  return rgbToHex(quantizedR, quantizedG, quantizedB);
}
