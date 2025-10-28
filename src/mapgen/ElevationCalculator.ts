import type { NoiseFunction2D } from "simplex-noise";
import { randomContinuousChoice, weightedRandomChoice, type RNG } from "../common/random";
import { ELEVATION_SETTINGS_DEFAULTS, type ElevationSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";

/** smoothstep for mask shaping */
const smoothstep = (a: number, b: number, x: number) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

type LineClump = {
    // Quadratic Bézier control points
    p0x: number; p0y: number;
    p1x: number; p1y: number; // control
    p2x: number; p2y: number;
    // Per-line params
    radiusScale: number;  // multiplies settings.baseRadius
    bend: number;         // stored for debugging; not used at runtime
    length: number;       // same
};

const numLineProbs = [
    { val: 1, prob: 0.6 },
    { val: 2, prob: 0.3 },
    { val: 3, prob: 0.1 },
];

// Rough ranges for line length and bend magnitude by count
const lengthRange = (n: number) => {
    // unit-ish coordinates around origin; tune to your world scale
    if (n === 1) return [0.1, 4];   // one big sweeping line
    if (n === 2) return [0.1, 1];
    return [0.1, 1];              // three shorter lines
};
const bendRange = (n: number) => {
    if (n === 1) return [0.15, 0.32];
    if (n === 2) return [0.12, 0.3];
    return [0.08, 0.3];
};

export class ElevationCalculator {
    private settings: ElevationSettings;

    // Multiple line clumps (1–3)
    private lines: LineClump[] = [];

    private noise2D: NoiseFunction2D;

    constructor(rng: RNG, noise2D: NoiseFunction2D, opts?: Partial<ElevationSettings>) {
        this.noise2D = noise2D;
        this.settings = { ...ELEVATION_SETTINGS_DEFAULTS, ...(opts ?? {}) };

        // Pick 1–3 lines
        const n = weightedRandomChoice(numLineProbs, rng);

        // Slightly retune a few knobs for “line islands”
        // (baseRadius now means tube radius; ripple nudged for better strand edges)
        this.settings = {
            ...this.settings,
            // Reuse your noise/warp params; tweak ripple a bit for tubes
            ripple: randomContinuousChoice(0.3, 0.8, rng),
            // centerDrift is used to place lines around the origin
            centerDrift: Math.max(0.6, this.settings.centerDrift),
        };

        const [lenMin, lenMax] = lengthRange(n);
        const [bendMin, bendMax] = bendRange(n);

        for (let i = 0; i < n; i++) {
            // Random direction & length
            const theta = rng() * Math.PI * 2;
            const L = randomContinuousChoice(lenMin, lenMax, rng) * this.settings.centerDrift;

            // Endpoints roughly symmetric around origin, then jittered
            const half = L * 0.5;
            const dx = Math.cos(theta), dy = Math.sin(theta);

            const jx0 = (rng() - 0.5) * 0.15 * L;
            const jy0 = (rng() - 0.5) * 0.15 * L;
            const jx2 = (rng() - 0.5) * 0.15 * L;
            const jy2 = (rng() - 0.5) * 0.15 * L;

            const p0x = -dx * half + jx0;
            const p0y = -dy * half + jy0;
            const p2x = +dx * half + jx2;
            const p2y = +dy * half + jy2;

            // Control point: along perpendicular with random bend
            const nx = -dy, ny = dx;
            const bendMag = randomContinuousChoice(bendMin, bendMax, rng) * L;
            const signed = (rng() < 0.5 ? -1 : 1);
            const cxOff = nx * bendMag * signed;
            const cyOff = ny * bendMag * signed;
            // Control at midpoint + perpendicular offset
            const midx = (p0x + p2x) * 0.5;
            const midy = (p0y + p2y) * 0.5;
            const p1x = midx + cxOff;
            const p1y = midy + cyOff;

            const radiusJitter = lerp(0.8, 1.25, rng());
            const line: LineClump = {
                p0x, p0y, p1x, p1y, p2x, p2y,
                radiusScale: radiusJitter,
                bend: bendMag,
                length: L,
            };
            this.lines.push(line);
        }
    }

    public maskedElevation(
        x: number,
        y: number,
        terrainFrequency: number,
        clumpiness: number,
    ): number {
        const base = this.fbm2(x, y, terrainFrequency);
        const mask = this.sampleAA(x, y, terrainFrequency); // 0 inside lines’ tubes → 1 outside all
        // if (mask === 0) {
        //     return 10;
        // }
        const C = this.coastField(mask, clumpiness);
        const elevation = this.blendElevation(base, C, Math.abs(clumpiness));
        return elevation;
    }

    /** 0 inside the winning line’s tube → 1 outside all */
    public sample(x: number, y: number, terrainFrequency: number): number {
        const { warpStrength, kWarp } = this.settings;
        const wx = x + warpStrength * (this.fbm2(kWarp * x, kWarp * y, terrainFrequency) - 0.5);
        const wy = y + warpStrength * (this.fbm2(kWarp * y, kWarp * x, terrainFrequency) - 0.5);

        const sd = this.exclusiveSignedDistance(wx, wy, terrainFrequency);
        return smoothstep(-this.settings.softness, +this.settings.softness, sd);
    }

    /** 4-tap AA like before */
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
     *  c = +1 ⇒ C = (1 - mask)   (islands: land along the lines, water edges)
     *  c = -1 ⇒ C = mask         (inverted)
     *  c =  0 ⇒ C = 0.5
     */
    public coastField(maskVal: number, clumpiness: number): number {
        return lerp((1 + clumpiness), (1 - clumpiness), maskVal) * 0.5;
    }

    /** amt=|clumpiness|; pulls base toward C by half, scaled by amt */
    public blendElevation(base: number, C: number, amt: number): number {
        return base + 0.5 * amt * (C - base);
    }

    // --- internals (line version) --- //

    /**
     * Exclusive SDF: choose the *single* nearest line “tube”.
     * This satisfies “points not already being influenced by another line”:
     * per sample, one winner; others ignored.
     */
    private exclusiveSignedDistance(x: number, y: number, terrainFrequency: number): number {
        let best = Infinity;

        for (let i = 0; i < this.lines.length; i++) {
            const li = this.lines[i];
            const d = this.lineSignedDistance(li, x, y, terrainFrequency);
            if (d < best) best = d;
        }
        return best;
    }

    /**
     * Signed distance to a quadratic Bézier “tube” with noisy radius.
     * sd = (distance to curve) - (radius(t) + ripple(x,y))
     * Negative => inside tube (land if clumpiness>0).
     */
    private lineSignedDistance(
        L: LineClump,
        x: number,
        y: number,
        terrainFrequency: number
    ): number {
        // Find closest point on the curve via sampled search + two refinements.
        // This is fast and robust for terrain; N=12 is a good sweet spot.
        let tBest = 0;
        let dBest = Infinity;

        const N = 12;
        for (let k = 0; k <= N; k++) {
            const t = k / N;
            const px = this.qbez(L.p0x, L.p1x, L.p2x, t);
            const py = this.qbez(L.p0y, L.p1y, L.p2y, t);
            const d = Math.hypot(px - x, py - y);
            if (d < dBest) { dBest = d; tBest = t; }
        }

        // Two local refinements around tBest (parabolic 1D step)
        tBest = this.refineT(L, x, y, tBest, 0.08);
        tBest = this.refineT(L, x, y, tBest, 0.025);

        const px = this.qbez(L.p0x, L.p1x, L.p2x, tBest);
        const py = this.qbez(L.p0y, L.p1y, L.p2y, tBest);
        const dist = Math.hypot(px - x, py - y);

        // Tube radius varies slightly along t (fatter mid, thinner ends), then line-level scale
        const baseR = this.settings.baseRadius * L.radiusScale;
        const bell = 0.6 + 0.4 * (1 - Math.abs(2 * tBest - 1)); // max at center
        const radiusT = baseR * bell;

        // Ripple using your fbm2 (domain-warp-friendly), respectful of terrainFrequency
        const { kRip, ripple } = this.settings;
        const rip = ripple * (this.fbm2(kRip * px, kRip * py, terrainFrequency) - 0.5);

        // Signed distance to noisy tube
        return (dist - (radiusT + rip));
    }

    /** Quadratic Bézier component */
    private qbez(a: number, b: number, c: number, t: number): number {
        const s = 1 - t;
        return s * s * a + 2 * s * t * b + t * t * c;
    }

    /**
     * Tiny 1D refinement step around t0: try t0±h and t0, fit a parabola, step to its minimum.
     * Clamps to [0,1]. Fast and good enough for terrains.
     */
    private refineT(L: LineClump, x: number, y: number, t0: number, h: number): number {
        const tL = clamp(t0 - h);
        const tC = clamp(t0);
        const tR = clamp(t0 + h);

        const dL = this.distAt(L, x, y, tL);
        const dC = this.distAt(L, x, y, tC);
        const dR = this.distAt(L, x, y, tR);

        // Quadratic fit vertex (avoid division by small denom)
        const denom = (dL - 2 * dC + dR);
        if (Math.abs(denom) < 1e-6) return t0;
        let t = tC + (h * (dL - dR)) / (2 * denom);
        return clamp(t);
    }

    private distAt(L: LineClump, x: number, y: number, t: number): number {
        const px = this.qbez(L.p0x, L.p1x, L.p2x, t);
        const py = this.qbez(L.p0y, L.p1y, L.p2y, t);
        return Math.hypot(px - x, py - y);
    }

    // --- you already had these noise helpers --- //

    // two-octave noise → ~[0,1]
    private fbm2 = (x: number, y: number, terrainFrequency: number) => {
        const n1 = this.noise2D(x / terrainFrequency, y / terrainFrequency);
        const n2 = this.noise2D((2 * x) / terrainFrequency, (2 * y) / terrainFrequency);
        return clamp(0.5 + 0.35 * n1 + 0.15 * n2);
    };
}
