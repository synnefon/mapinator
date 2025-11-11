import type { Theme } from "./biomes";
import { getLuminance, hexToRgb, hexToRgba } from "./colorUtils";

export interface ThemeUIColors {
  bg: string;
  text: string;
  highlight: string;
  highlightText: string;
}

/**
 * UI color palettes for each theme.
 * These colors are applied to CSS variables (--bg, --text, --highlight, --highlightText)
 * to style the UI elements (sidebar, buttons, text) to match the map theme.
 *
 * highlightText is the color of text/icons that appear ON highlighted elements
 * (e.g., selected theme labels, hovered buttons)
 */
export const THEME_UI_COLORS: Record<Theme, ThemeUIColors> = {
  default: {
    bg:"rgb(200, 200, 200)",
    text:"#000000",
    highlight: "#0000ff",
    highlightText: "rgb(200, 200, 200)",
  },
  arid: {
    bg: "#131322",
    text: "#bbae8c",
    highlight: "#96854d",
    highlightText: "#181828",
  },
  lush: {
    bg: "#131322",
      text:"#b8c9c1",
    highlight: "#4d8f45",
    highlightText: "#181828",
  },
  rainbow: {
    bg: "#44447a",
    text: "#f8961e",
    highlight: "#f94144",
    highlightText: "#e8f5e9",
  },
  oasis: {
    bg: "#A89168",
    text: "#04009A",
    highlight: "#E3D2A6",
    highlightText: "#04009A",
  },
  grayscale: {
    bg: "#5a5a5a",
    text: "#e0e0e0",
    highlight: "#2e2d2d",
    highlightText: "#e0e0e0",
  },
  volcano: {
    bg: "#1A1A1A", 
    text: "#907168",
    highlight: "#78493C",
    highlightText: "#CDCEC4",
  },
};

/**
 * Generate a CSS filter that approximates a target color.
 * This uses a simple brightness + invert approach for SVG recoloring.
 */
function generateColorFilter(hexColor: string): string {
  const rgb = hexToRgb(hexColor);
  if (!rgb) return "";

  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);

  // If the color is dark (low luminance), we want to invert and darken
  // If the color is light (high luminance), we want to keep it light
  if (luminance < 0.5) {
    // Dark color: start with black then apply brightness
    const brightness = luminance * 200; // Scale to 0-100%
    return `brightness(0) saturate(100%) invert(0) brightness(${brightness}%)`;
  } else {
    // Light color: invert to white then adjust brightness
    const brightness = 50 + luminance * 100; // Scale to 50-150%
    return `brightness(0) saturate(100%) invert(1) brightness(${brightness}%)`;
  }
}

/**
 * Apply theme-specific UI colors to CSS custom properties.
 * This updates the global CSS variables that style the UI elements.
 *
 * @param theme - The theme to apply
 */
export function applyThemeUIColors(theme: Theme): void {
  const colors = THEME_UI_COLORS[theme];
  const root = document.documentElement;

  root.style.setProperty("--bg", colors.bg);
  root.style.setProperty("--text", colors.text);
  root.style.setProperty("--highlight", colors.highlight);
  root.style.setProperty("--highlightText", colors.highlightText);

  // Generate and apply filters for SVG buttons
  const textFilter = generateColorFilter(colors.text);
  const highlightTextFilter = generateColorFilter(colors.highlightText);
  root.style.setProperty("--text-filter", textFilter);
  root.style.setProperty("--highlightText-filter", highlightTextFilter);
}

/**
 * Generate CSS rules for theme radio buttons.
 * Each theme button displays its own colors when hovered/selected,
 * regardless of the currently active theme.
 *
 * @returns CSS string with rules for all themes
 */
export function generateThemeButtonCSS(): string {
  const rules: string[] = [];

  for (const [theme, colors] of Object.entries(THEME_UI_COLORS)) {
    rules.push(`
      /* ${theme} theme colors */
      #themeRadioList label:has(input[value="${theme}"]):hover {
        background-color: ${hexToRgba(colors.highlight, 0.75)};
        color: ${colors.highlightText};
      }
      #themeRadioList label:has(input[value="${theme}"]:checked),
      #themeRadioList label:has(input[value="${theme}"]:active) {
        background-color: ${colors.highlight};
        color: ${colors.highlightText};
      }
    `);
  }

  return rules.join("\n");
}
