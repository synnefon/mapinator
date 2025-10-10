import type { NoiseFunction2D } from "simplex-noise";
import { weightedRandomChoice, type RNG } from "../common/random";
import { ELEVATION_SETTINGS_DEFAULTS, type ElevationSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";

const smoothstep = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

type ClumpCenter = {
    cx: number;
    cy: number;
    rotS: number;
    rotC: number;
};

export class ElevationCalculator {
    private settings: ElevationSettings;

    // multiple centers:
    private centers: ClumpCenter[] = [];

    private noise2D: NoiseFunction2D;

    constructor(rng: RNG, noise2D: NoiseFunction2D, opts?: Partial<ElevationSettings>) {
        this.settings = { ...ELEVATION_SETTINGS_DEFAULTS, ...(opts ?? {}) };
        this.noise2D = noise2D;

        // how many blobs to union together
        // const n = Math.max(1, Math.floor(this.settings.numCenters ?? 2));
        const n = weightedRandomChoice([
            {val: 1, prob: 0.5},
            {val: 2, prob: 0.25},
            {val: 3, prob: 0.2},
            {val: 3, prob: 0.05},
        ])

        this.settings.baseRadius = n > 1 ? 0.25 : this.settings.baseRadius;

        // spawn N random “poses” (offset + rotation) within centerDrift envelope
        for (let i = 0; i < n; i++) {
            const cx = (rng() - 0.5) * this.settings.centerDrift;
            const cy = (rng() - 0.5) * this.settings.centerDrift;
            const theta = rng() * Math.PI * 2;
            this.centers.push({ cx, cy, rotS: Math.sin(theta), rotC: Math.cos(theta) });
        }
    }

    public maskedElevation(
        x: number,
        y: number,
        terrainFrequency: number,
        clumpiness: number,
    ): number {
        const base = this.fbm2(x, y, terrainFrequency);
        const mask = this.sampleAA(x, y, terrainFrequency);          // 0 center → 1 edges (now multi-blob)
        const C = this.coastField(mask, clumpiness);
        const elevation = this.blendElevation(base, C, Math.abs(clumpiness));
        return elevation;
    }

    /** 0 inside any blob → 1 outside all (smooth union) */
    public sample(x: number, y: number, terrainFrequency: number): number {
        const sd = this.compositeSignedDistance(x, y, terrainFrequency);
        return smoothstep(-this.settings.softness, +this.settings.softness, sd);
    }

    /** 4-tap rotated-grid AA */
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
     *  c = +1 ⇒ C = (1 - mask)   (islands: land center(s), water edges)
     *  c = -1 ⇒ C = mask         (Med:    water center(s), land edges)
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

    /** Smooth-min (log-sum-exp) for stable unions of SDFs */
    private sminExp(a: number, b: number, k: number) {
        const kk = Math.max(1e-3, k);
        return -Math.log(Math.exp(-kk * a) + Math.exp(-kk * b)) / kk;
    }

    private compositeSignedDistance(x: number, y: number, terrainFrequency: number): number {
        // pull hardness from settings or default
        // const k = this.settings.unionHardness ?? 10.0;
        const k = 100;
        let sd = Infinity;
        for (let i = 0; i < this.centers.length; i++) {
            const c = this.centers[i];
            const { wx, wy } = this.warpedWithCenter(x, y, terrainFrequency, c);
            const d = this.signedDistance(wx, wy, terrainFrequency);
            sd = (i === 0) ? d : this.sminExp(sd, d, k);
        }
        return sd;
    }

    /** translate+rotate by a specific center’s pose, then domain-warp */
    private warpedWithCenter(x: number, y: number, terrainFrequency: number, c: ClumpCenter) {
        const { warpStrength, kWarp } = this.settings;

        // local space around this center
        const xt = x - c.cx, yt = y - c.cy;
        const xr = xt * c.rotC + yt * c.rotS;
        const yr = -xt * c.rotS + yt * c.rotC;

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
