import type { NoiseFunction2D } from "simplex-noise";
import { type RNG } from "../common/random";
import type { ElevationSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";

export const DEFAULT_ELEVATION_SETTINGS: ElevationSettings = {
    centerDrift: 0.22,
    baseRadius: 0.35,
    warpStrength: 0.5,
    ripple: 0.5,
    kWarp: 2,
    kRip: 2.2,
    softness: 0.3,
    aaRadius: 0.015,
};

const smoothstep = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

export class ElevationCalculator {
    private settings: ElevationSettings;

    // frozen per-map pose
    private cx: number;
    private cy: number;
    private rotS: number;
    private rotC: number;
    private noise2D: NoiseFunction2D;

    constructor(rng: RNG, noise2D: NoiseFunction2D, opts?: Partial<ElevationSettings>) {
        this.settings = { ...DEFAULT_ELEVATION_SETTINGS, ...(opts ?? {}) };

        this.noise2D = noise2D;

        this.cx = (rng() - 0.5) * this.settings.centerDrift;
        this.cy = (rng() - 0.5) * this.settings.centerDrift;
        const theta = rng() * Math.PI * 2;
        this.rotS = Math.sin(theta);
        this.rotC = Math.cos(theta);
    }

    public maskedElevation(
        x: number,
        y: number,
        terrainFrequency: number,
        clumpiness: number,
    ): number {
        const base = this.fbm2(x, y, terrainFrequency);
        const mask = this.sampleAA(x, y, terrainFrequency);           // stable mask, 0 center → 1 edges
        const C = this.coastField(mask, clumpiness);
        const elevation = this.blendElevation(base, C, Math.abs(clumpiness));
        return elevation;
    }

    /** 0 inside blob → 1 outside (single sample, smooth edge) */
    public sample(x: number, y: number, terrainFrequency: number): number {
        const { wx, wy } = this.warped(x, y, terrainFrequency);
        const sd = this.signedDistance(wx, wy, terrainFrequency);
        return smoothstep(-this.settings.softness, +this.settings.softness, sd);
    }

    /** 4-tap rotated-grid AA to kill raster stair-steps */
    public sampleAA(x: number, y: number, terrainFrequency: number): number {
        const e = this.settings.aaRadius;
        let sum = 0;
        sum += this.sample(x + e, y, terrainFrequency);
        sum += this.sample(x - e, y, terrainFrequency);
        sum += this.sample(x, y + e, terrainFrequency);
        sum += this.sample(x, y - e, terrainFrequency);
        return sum * 0.25;
    }

    /**
     * Unified coast field C(c):
     *  c = +1 ⇒ C = (1 - mask)  (island: land center, water edges)
     *  c = -1 ⇒ C = mask        (Med:   water center, land edges)
     *  c =  0 ⇒ C = 0.5
     */
    public coastField(maskVal: number, clumpiness: number): number {
        return lerp(0.5 * (1 + clumpiness), 0.5 * (1 - clumpiness), maskVal);
    }

    /** amt=|clumpiness|; pulls base toward C by half, scaled by amt */
    public blendElevation(base: number, C: number, amt: number): number {
        return base + 0.5 * amt * (C - base);
    }

    // --- internals --- //

    private warped(x: number, y: number, terrainFrequency: number) {
        const { warpStrength, kWarp } = this.settings;
        // translate + rotate (frozen pose)
        const xt = x - this.cx, yt = y - this.cy;
        const xr = xt * this.rotC + yt * this.rotS;
        const yr = -xt * this.rotS + yt * this.rotC;

        // domain warp (frozen amps/freqs)
        const wx = xr + warpStrength * (this.fbm2(kWarp * xr, kWarp * yr, terrainFrequency) - 0.5);
        const wy = yr + warpStrength * (this.fbm2(kWarp * yr, kWarp * xr, terrainFrequency) - 0.5);
        return { wx, wy };
    }

    private signedDistance(wx: number, wy: number, terrainFrequency: number) {
        const { baseRadius, ripple, kRip } = this.settings;
        const r = Math.hypot(wx, wy);
        const rip = ripple * (this.fbm2(kRip * wx, kRip * wy, terrainFrequency) - 0.5);
        return (r - baseRadius) - rip; // <0 inside, >0 outside
    }

    // two-octave noise → ~[0,1]
    private fbm2 = (x: number, y: number, terrainFrequency: number) => {
        const n1 = this.noise2D(x / terrainFrequency, y / terrainFrequency);
        const n2 = this.noise2D((2 * x) / terrainFrequency, (2 * y) / terrainFrequency);
        return clamp(0.5 + 0.35 * n1 + 0.15 * n2);
    };
}
