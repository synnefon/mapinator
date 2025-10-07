import { BANDS, BASE_LIGHTNESS, Biomes, MOISTURE_BY_FAMILY, THEME_OVERRIDES, type BandSpec, type BiomeKey, type ColorScheme, type ElevationBand } from "../common/biomes";
import { clamp } from "../common/util";

/** ===================== Engine with Controls ===================== */
export class BiomeEngine {
    private rainfall: number;   // exponent
    private seaLevel: number;   // -1..1
    private EPS = 1e-9;

    constructor(rainfall: number, seaLevel: number) {
        if (rainfall < 0 || rainfall > 1 || seaLevel < 0 || seaLevel > 1) {
            throw Error("rainfall & seaLevel must be 0-1");
        }

        // Moisture shaping
        const shaped = this.expCurve(1 - rainfall, 4.1);
        this.rainfall = Math.max(0.01, shaped * 25);

        // Normalize sea level to -1..1
        this.seaLevel = 2.0 * (seaLevel - 0.5);
    }

    private expCurve(x: number, k: number): number {
        const clamped = Math.max(0, Math.min(1, x));
        return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
    }

    /** Internal: apply sea level shift & rainfall exponent */
    private shapeForRules(elevation: number, moisture: number): { e: number; m: number } {
        // map elevation 0..1 -> [-1..1], then shift by sea level (lower sea => more land)
        let e = (2.0 * (elevation - 0.5)) - (this.seaLevel - 0.1);
        // moisture exponent
        let m = Math.pow(moisture, this.rainfall);

        // clamp to rule space
        e = Math.max(Math.min(e, 1 - this.EPS), -1);
        m = Math.max(Math.min(m, 1 - this.EPS), -0); // moisture rules are [0..1]
        return { e, m };
    }

    /** Elevation+moisture -> BiomeKey, using shaped values */
    public biomeAt(elevation: number, moisture: number): BiomeKey {
        const { e, m } = this.shapeForRules(elevation, moisture);

        // Ocean short-circuit
        if (e < 0) return "OCEAN";

        // Find family by shaped elevation
        const band = getElevationBandRaw(e);
        const family = band?.family ?? "LOW";

        if (family === "OCEAN") return "OCEAN";

        // Moisture bucket lookup (moisture ranges are unchanged)
        const rules = MOISTURE_BY_FAMILY[family];
        const hit = rules.find(r => m >= r.m[0] && m <= r.m[1]);
        return hit ? hit.key : "OCEAN"; // safe fallback
    }

    /** Theme-aware color; uses RAW elevation for shading (no vertical “rise/drop”) */
    public colorForBiome(scheme: ColorScheme, biomeKey: BiomeKey, rawElevation: number): string {
        const base = Biomes[scheme][biomeKey].color;
        if (biomeKey === "OCEAN" || rawElevation < 0) return base;

        const band = getElevationBandRaw(rawElevation);
        if (!band || band.family === "OCEAN") return base;

        const adj = resolveTheme(scheme);
        const { h, s, l } = hexToHsl(base);
        const s2 = adj.forceGreyscale ? 0 : clamp(s * (adj.saturationScale ?? 1));
        const delta = (adj.lightness as Record<ElevationBand, number>)[band.name as ElevationBand] ?? 0;
        const l2 = clamp(l + delta);
        return hslToHex(h, s2, l2);
    }

    /** One-stop: elevation+moisture -> themed color */
    public colorAt(scheme: ColorScheme, elevation: number, moisture: number): string {
        const key = this.biomeAt(elevation, moisture);
        return this.colorForBiome(scheme, key, elevation);
    }
}

export function getElevationBandRaw(e: number): BandSpec | null {
    for (const b of BANDS) if (e >= b.range[0] && e <= b.range[1]) return b;
    return null;
}

function resolveTheme(scheme: ColorScheme) {
    const o = THEME_OVERRIDES[scheme] ?? {};
    const lightness: Record<ElevationBand, number> = { ...BASE_LIGHTNESS, ...(o.lightness ?? {}) };
    const saturationScale = o.saturationScale ?? 1.0;
    const forceGreyscale = !!o.forceGreyscale;
    return { lightness, saturationScale, forceGreyscale };
}

/** ===================== Hex/HSL utils ===================== */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(x => x + x).join("");
    const r = parseInt(c.slice(0, 2), 16) / 255;
    const g = parseInt(c.slice(2, 4), 16) / 255;
    const b = parseInt(c.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;
    let h = 0;
    if (d !== 0) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
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
    let r = 0, g = 0, b = 0;
    if (0 <= h && h < 60) { r = c; g = x; b = 0; }
    else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
    else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
    else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
    else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}
