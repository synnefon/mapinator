import type { NoiseFunction2D } from "simplex-noise";
import { randomContinuousChoice, weightedRandomChoice, type RNG } from "../common/random";
import { ELEVATION_SETTINGS_DEFAULTS, type ElevationSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";

/** ================================
 *  DIALS — All expressed as ranges
 *  (midpoint = current behavior)
 *  ================================ */
export const DIALS = {
    // Distribution over line counts
    LINE_COUNT_PROBS: [
        { val: 1 as const, prob: 0.6 as const },
        { val: 2 as const, prob: 0.3 as const },
        { val: 3 as const, prob: 0.1 as const },
    ],

    // Per-count length & bend ranges
    LENGTH_RANGE_BY_COUNT: {
        1: [0.1, 5] as const,
        2: [0.1, 2] as const,
        3: [0.1, 1] as const,
    },
    BEND_RANGE_BY_COUNT: {
        1: [0.10, 0.32] as const,
        2: [0.12, 0.30] as const,
        3: [0.08, 0.30] as const,
    },

    // scalars
    ENDPOINT_JITTER_FRACTION_RANGE: [0.10, 0.30] as const, // mid=0.20
    RADIUS_JITTER_RANGE: [0.10, 1.30] as const,

    // Tube profile along t
    BELL_BASE_RANGE: [0.4, 0.8] as const,                   // mid=0.6
    BELL_GAIN_RANGE: [0.2, 0.6] as const,                   // mid=0.4

    // fbm2 blend weights (we still clamp output)
    FBM2_W1_RANGE: [0.25, 0.45] as const,                   // mid=0.35
    FBM2_W2_RANGE: [0.05, 0.25] as const,                   // mid=0.15

    // Auto-retune guardrail
    MIN_CENTER_DRIFT_RANGE: [0.3, 0.7] as const,            // mid=0.6

    // Ripple randomization range (used to draw a concrete ripple value)
    RIPPLE_RANDOM_RANGE: [0.3, 0.8] as const,
} as const;

/** =========================================
 *  ADVANCED_DIALS — perf/quality trade-offs
 *  ========================================= */
export const ADVANCED_DIALS = {
    CURVE_COARSE_STEPS: 30,                        // inclusive (0..N)
    REFINE_STEPS: [0.08, 0.025] as const,

    COAST_FIELD_SCALE: 0.5,

    AA_CARDINAL_OFFSETS: [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ] as const,
} as const;

/** =================================
 *  INVARIANTS — math/stability
 *  ================================= */
export const INVARIANTS = {
    TAU: Math.PI * 2,
    MIDPOINT_FRACTION: 0.5,
    WARP_NOISE_CENTER: 0.5,
    RIPPLE_NOISE_CENTER: 0.5,
    PARABOLA_EPS: 1e-6,
    FBM2_CENTER: 0.5,
} as const;

export function sampleDial(
    range: readonly [number, number],
    rng: () => number,
): number {
    return randomContinuousChoice(range[0], range[1], rng)
}

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
    bend: number;         // debug
    length: number;       // debug
};

export class ElevationCalculator {
    private settings: ElevationSettings;
    private lines: LineClump[] = [];
    private noise2D: NoiseFunction2D;

    // Instance-sampled dials (fixed per calculator instance)
    private readonly endpointJitterFraction: number;
    private readonly bellBase: number;
    private readonly bellGain: number;
    private readonly fbmW1: number;
    private readonly fbmW2: number;
    private readonly minCenterDrift: number;

    constructor(
        rng: RNG,
        noise2D: NoiseFunction2D,
        opts?: Partial<ElevationSettings>,
    ) {
        this.noise2D = noise2D;
        this.settings = { ...ELEVATION_SETTINGS_DEFAULTS, ...(opts ?? {}) };

        // Sample dials (midpoint by default = current behavior)
        this.endpointJitterFraction = sampleDial(DIALS.ENDPOINT_JITTER_FRACTION_RANGE, rng);
        this.bellBase = sampleDial(DIALS.BELL_BASE_RANGE, rng);
        this.bellGain = sampleDial(DIALS.BELL_GAIN_RANGE, rng);
        this.fbmW1 = sampleDial(DIALS.FBM2_W1_RANGE, rng);
        this.fbmW2 = sampleDial(DIALS.FBM2_W2_RANGE, rng);
        this.minCenterDrift = sampleDial(DIALS.MIN_CENTER_DRIFT_RANGE, rng);

        // Pick 1–3 lines
        const n = weightedRandomChoice(DIALS.LINE_COUNT_PROBS as unknown as { val: number, prob: number }[], rng) as 1 | 2 | 3;

        // Slight retune for “line islands”
        this.settings = {
            ...this.settings,
            // draw a concrete ripple value from range
            ripple: randomContinuousChoice(DIALS.RIPPLE_RANDOM_RANGE[0], DIALS.RIPPLE_RANDOM_RANGE[1], rng),
            // enforce minimum drift based on sampled guardrail
            centerDrift: Math.max(this.minCenterDrift, this.settings.centerDrift),
        };

        // Per-count ranges
        const [lenMin, lenMax] = DIALS.LENGTH_RANGE_BY_COUNT[n];
        const [bendMin, bendMax] = DIALS.BEND_RANGE_BY_COUNT[n];

        // Build lines
        for (let i = 0; i < n; i++) {
            // Random direction & length
            const theta = rng() * INVARIANTS.TAU;
            const L = randomContinuousChoice(lenMin, lenMax, rng) * this.settings.centerDrift;

            // Endpoints roughly symmetric around origin, then jittered
            const half = L * INVARIANTS.MIDPOINT_FRACTION;
            const dx = Math.cos(theta), dy = Math.sin(theta);

            const jitter = (this.endpointJitterFraction * L);
            const jx0 = (rng() - INVARIANTS.WARP_NOISE_CENTER) * jitter;
            const jy0 = (rng() - INVARIANTS.WARP_NOISE_CENTER) * jitter;
            const jx2 = (rng() - INVARIANTS.WARP_NOISE_CENTER) * jitter;
            const jy2 = (rng() - INVARIANTS.WARP_NOISE_CENTER) * jitter;

            const p0x = -dx * half + jx0;
            const p0y = -dy * half + jy0;
            const p2x = +dx * half + jx2;
            const p2y = +dy * half + jy2;

            // Control point: along perpendicular with random bend
            const nx = -dy, ny = dx;
            const bendMag = randomContinuousChoice(bendMin, bendMax, rng) * L;
            const signed = (rng() < INVARIANTS.MIDPOINT_FRACTION ? -1 : 1);
            const cxOff = nx * bendMag * signed;
            const cyOff = ny * bendMag * signed;

            // Control at midpoint + perpendicular offset
            const midx = (p0x + p2x) * INVARIANTS.MIDPOINT_FRACTION;
            const midy = (p0y + p2y) * INVARIANTS.MIDPOINT_FRACTION;
            const p1x = midx + cxOff;
            const p1y = midy + cyOff;

            // Per-line radius jitter
            const radiusJitter = lerp(
                DIALS.RADIUS_JITTER_RANGE[0],
                DIALS.RADIUS_JITTER_RANGE[1],
                rng()
            );

            this.lines.push({
                p0x, p0y, p1x, p1y, p2x, p2y,
                radiusScale: radiusJitter,
                bend: bendMag,
                length: L,
            });
        }

        console.log("[ElevationCalculator] Dial selections", {
            endpointJitterFraction: this.endpointJitterFraction,
            bellBase: this.bellBase,
            bellGain: this.bellGain,
            fbmW1: this.fbmW1,
            fbmW2: this.fbmW2,
            minCenterDrift: this.minCenterDrift,
            ripple: this.settings.ripple,
            lineCount: this.lines.length,
            lineParams: this.lines.map((l, i) => ({
                i,
                length: l.length.toFixed(3),
                bend: l.bend.toFixed(3),
                radiusScale: l.radiusScale.toFixed(3),
            })),
        });
    }

    /** Top-level elevation with mask-driven coast field blend */
    public maskedElevation(
        x: number,
        y: number,
        terrainFrequency: number,
        clumpiness: number,
    ): number {
        const base = this.fbm2(x, y, terrainFrequency);
        const mask = this.sampleAA(x, y, terrainFrequency); // 0 inside tubes → 1 outside all
        const C = this.coastField(mask, clumpiness);
        return this.blendElevation(base, C, Math.abs(clumpiness));
    }

    /** 0 inside the winning line’s tube → 1 outside all */
    public sample(x: number, y: number, terrainFrequency: number): number {
        const { warpStrength, kWarp, softness } = this.settings;
        const wx = x + warpStrength * (this.fbm2(kWarp * x, kWarp * y, terrainFrequency) - INVARIANTS.WARP_NOISE_CENTER);
        const wy = y + warpStrength * (this.fbm2(kWarp * y, kWarp * x, terrainFrequency) - INVARIANTS.WARP_NOISE_CENTER);

        const sd = this.exclusiveSignedDistance(wx, wy, terrainFrequency);
        return smoothstep(-softness, +softness, sd);
    }

    /** 4-tap AA */
    public sampleAA(x: number, y: number, terrainFrequency: number): number {
        const e = this.settings.aaRadius;
        let sum = 0;
        for (const [ox, oy] of ADVANCED_DIALS.AA_CARDINAL_OFFSETS) {
            sum += this.sample(x + ox * e, y + oy * e, terrainFrequency);
        }
        return sum / ADVANCED_DIALS.AA_CARDINAL_OFFSETS.length;
    }

    /**
     * Unified coast field C(c):
     *  c = +1 ⇒ C = (1 - mask)   (islands: land along the lines, water edges)
     *  c = -1 ⇒ C = mask         (inverted)
     *  c =  0 ⇒ C = 0.5
     */
    public coastField(maskVal: number, clumpiness: number): number {
        return lerp((1 + clumpiness), (1 - clumpiness), maskVal) * ADVANCED_DIALS.COAST_FIELD_SCALE;
    }

    /** amt=|clumpiness|; pulls base toward C by half, scaled by amt */
    public blendElevation(base: number, C: number, amt: number): number {
        return base + ADVANCED_DIALS.COAST_FIELD_SCALE * amt * (C - base);
    }

    // --- internals (line version) --- //

    /** one-winner SDF among all line “tubes” */
    private exclusiveSignedDistance(x: number, y: number, terrainFrequency: number): number {
        let best = Infinity;
        for (let i = 0; i < this.lines.length; i++) {
            const d = this.lineSignedDistance(this.lines[i], x, y, terrainFrequency);
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
        // Coarse nearest-on-curve search
        let tBest = 0;
        let dBest = Infinity;

        for (let k = 0; k <= ADVANCED_DIALS.CURVE_COARSE_STEPS; k++) {
            const t = k / ADVANCED_DIALS.CURVE_COARSE_STEPS;
            const px = this.qbez(L.p0x, L.p1x, L.p2x, t);
            const py = this.qbez(L.p0y, L.p1y, L.p2y, t);
            const d = Math.hypot(px - x, py - y);
            if (d < dBest) { dBest = d; tBest = t; }
        }

        // Local refinements
        for (const h of ADVANCED_DIALS.REFINE_STEPS) {
            tBest = this.refineT(L, x, y, tBest, h);
        }

        const px = this.qbez(L.p0x, L.p1x, L.p2x, tBest);
        const py = this.qbez(L.p0y, L.p1y, L.p2y, tBest);
        const dist = Math.hypot(px - x, py - y);

        // Tube radius varies along t (fatter mid, thinner ends), then line-level scale
        const baseR = this.settings.baseRadius * L.radiusScale;
        const bellCentering = 1 - Math.abs(2 * tBest - 1);
        const radiusT = baseR * (this.bellBase + this.bellGain * bellCentering);

        // Ripple using fbm2 (domain-warp-friendly), respectful of terrainFrequency
        const { kRip, ripple } = this.settings;
        const rip = ripple * (this.fbm2(kRip * px, kRip * py, terrainFrequency) - INVARIANTS.RIPPLE_NOISE_CENTER);

        // Signed distance to noisy tube
        return (dist - (radiusT + rip));
    }

    /** Quadratic Bézier component */
    private qbez(a: number, b: number, c: number, t: number): number {
        const s = 1 - t;
        return s * s * a + 2 * s * t * b + t * t * c;
    }

    /**
     * Tiny 1D refinement around t0: try t0±h and t0, fit a parabola, step to minimum.
     * Clamps to [0,1].
     */
    private refineT(L: LineClump, x: number, y: number, t0: number, h: number): number {
        const tL = clamp(t0 - h);
        const tC = clamp(t0);
        const tR = clamp(t0 + h);

        const dL = this.distAt(L, x, y, tL);
        const dC = this.distAt(L, x, y, tC);
        const dR = this.distAt(L, x, y, tR);

        const denom = (dL - 2 * dC + dR);
        if (Math.abs(denom) < INVARIANTS.PARABOLA_EPS) return t0;
        const t = tC + (h * (dL - dR)) / (2 * denom);
        return clamp(t);
    }

    private distAt(L: LineClump, x: number, y: number, t: number): number {
        const px = this.qbez(L.p0x, L.p1x, L.p2x, t);
        const py = this.qbez(L.p0y, L.p1y, L.p2y, t);
        return Math.hypot(px - x, py - y);
    }

    // --- noise helpers --- //

    // two-octave noise → ~[0,1]
    private fbm2 = (x: number, y: number, terrainFrequency: number) => {
        const n1 = this.noise2D(x / terrainFrequency, y / terrainFrequency);
        const n2 = this.noise2D((2 * x) / terrainFrequency, (2 * y) / terrainFrequency);
        return clamp(INVARIANTS.FBM2_CENTER + this.fbmW1 * n1 + this.fbmW2 * n2);
    };
}
