import type { NoiseFunction2D } from "simplex-noise";
import { printSection } from "../common/printUtils";
import {
  randomContinuousChoice,
  weightedRandomChoice,
  type RNG,
} from "../common/random";
import {
  ADVANCED_DIALS,
  DIALS,
  INVARIANTS,
  sampleDial,
} from "../common/settings";
import { clamp, lerp } from "../common/util";

/** smoothstep for mask shaping */
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type LineClump = {
  // Quadratic Bézier control points
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number; // control
  p2x: number;
  p2y: number;
  // Per-line params
  radiusScale: number; // multiplies settings.baseRadius
  bend: number; // debug
  length: number; // debug
};

export class ElevationCalculator {
  private lines: LineClump[] = [];
  private noise2D: NoiseFunction2D;
  private settings = {
    endpointJitterFraction: 0,
    bellBase: 0,
    bellGain: 0,
    fbmW1: 0,
    fbmW2: 0,
    minCenterDrift: 0,
    ripple: 0,
    centerDrift: 0,
    baseRadius: 0,
    warpStrength: 0,
    kWarp: 0,
    softness: 0,
    aaRadius: 0,
  };

  constructor(rng: RNG, noise2D: NoiseFunction2D) {
    this.noise2D = noise2D;

    this.initializeDials(rng);
    // Pick 1–3 lines
    const n = weightedRandomChoice(
      DIALS.LINE_COUNT_PROBS as unknown as { val: number; prob: number }[],
      rng
    ) as 1 | 2 | 3;

    // Per-count ranges
    const [lenMin, lenMax] = DIALS.LENGTH_RANGE_BY_COUNT[n];
    const [bendMin, bendMax] = DIALS.BEND_RANGE_BY_COUNT[n];

    // Build lines
    for (let i = 0; i < n; i++) {
      // Random direction & length
      const theta = rng() * Math.PI * 2;
      const L =
        randomContinuousChoice(lenMin, lenMax, rng) * this.settings.centerDrift;

      // Endpoints roughly symmetric around origin, then jittered
      const half = L * INVARIANTS.NEUTRAL_CENTER_POINT;
      const dx = Math.cos(theta),
        dy = Math.sin(theta);

      const jitter = this.settings.endpointJitterFraction * L;
      const jx0 = (rng() - INVARIANTS.NEUTRAL_CENTER_POINT) * jitter;
      const jy0 = (rng() - INVARIANTS.NEUTRAL_CENTER_POINT) * jitter;
      const jx2 = (rng() - INVARIANTS.NEUTRAL_CENTER_POINT) * jitter;
      const jy2 = (rng() - INVARIANTS.NEUTRAL_CENTER_POINT) * jitter;

      const p0x = -dx * half + jx0;
      const p0y = -dy * half + jy0;
      const p2x = +dx * half + jx2;
      const p2y = +dy * half + jy2;

      // Control point: along perpendicular with random bend
      const nx = -dy,
        ny = dx;
      const bendMag = randomContinuousChoice(bendMin, bendMax, rng) * L;
      const signed = rng() < INVARIANTS.NEUTRAL_CENTER_POINT ? -1 : 1;
      const cxOff = nx * bendMag * signed;
      const cyOff = ny * bendMag * signed;

      // Control at midpoint + perpendicular offset
      const midx = (p0x + p2x) * INVARIANTS.NEUTRAL_CENTER_POINT;
      const midy = (p0y + p2y) * INVARIANTS.NEUTRAL_CENTER_POINT;
      const p1x = midx + cxOff;
      const p1y = midy + cyOff;

      // Per-line radius jitter
      const radiusJitter = lerp(
        DIALS.RADIUS_JITTER_RANGE[0],
        DIALS.RADIUS_JITTER_RANGE[1],
        rng()
      );

      this.lines.push({
        p0x,
        p0y,
        p1x,
        p1y,
        p2x,
        p2y,
        radiusScale: radiusJitter,
        bend: bendMag,
        length: L,
      });
    }

    printSection(
      "ELEVATION SETTINGS",
      {
        key: "endpointJitterFraction",
        value: this.settings.endpointJitterFraction,
      },
      { key: "bellBase", value: this.settings.bellBase },
      { key: "bellGain", value: this.settings.bellGain },
      { key: "fbmW1", value: this.settings.fbmW1 },
      { key: "fbmW2", value: this.settings.fbmW2 },
      { key: "minCenterDrift", value: this.settings.minCenterDrift },
      { key: "ripple", value: this.settings.ripple },
      { key: "lineCount", value: this.lines.length },
      { key: "baseRadius", value: this.settings.baseRadius },
      { key: "warpStrength", value: this.settings.warpStrength },
      { key: "kWarp", value: this.settings.kWarp },
      { key: "softness", value: this.settings.softness },
      { key: "aaRadius", value: this.settings.aaRadius },
      {
        key: "lines",
        value: this.lines.map((l) =>
          [
            "length: " + l.length.toFixed(3),
            "bend: " + l.bend.toFixed(3),
            "radiusScale: " + l.radiusScale.toFixed(3),
          ].join(", ")
        ),
      }
    );
  }

  private initializeDials(rng: RNG) {
    this.settings = {
      endpointJitterFraction: sampleDial(
        DIALS.ENDPOINT_JITTER_FRACTION_RANGE,
        rng
      ),
      bellBase: sampleDial(DIALS.BELL_BASE_RANGE, rng),
      bellGain: sampleDial(DIALS.BELL_GAIN_RANGE, rng),
      fbmW1: sampleDial(DIALS.FBM2_W1_RANGE, rng),
      fbmW2: sampleDial(DIALS.FBM2_W2_RANGE, rng),
      minCenterDrift: sampleDial(DIALS.CENTER_DRIFT_RANGE, rng),
      ripple: sampleDial(DIALS.RIPPLE_INTENSITY_RANGE, rng),
      centerDrift: sampleDial(DIALS.CENTER_DRIFT_RANGE, rng),
      baseRadius: sampleDial(DIALS.BASE_RADIUS_RANGE, rng),
      warpStrength: sampleDial(DIALS.WARP_STRENGTH_RANGE, rng),
      kWarp: sampleDial(DIALS.WARP_FREQUENCY_RANGE, rng),
      softness: sampleDial(DIALS.SOFTNESS_RANGE, rng),
      aaRadius: sampleDial(DIALS.AA_RADIUS_RANGE, rng),
    };
  }

  /** Top-level elevation with mask-driven coast field blend */
  public maskedElevation(
    x: number,
    y: number,
    terrainFrequency: number,
    clumpiness: number
  ): number {
    const base = this.fbm2(x, y, terrainFrequency);
    const mask = this.sampleAA(x, y, terrainFrequency); // 0 inside tubes → 1 outside all
    const C = this.coastField(mask, clumpiness);
    return this.blendElevation(base, C, Math.abs(clumpiness));
  }

  /** 0 inside the winning line’s tube → 1 outside all */
  public sample(x: number, y: number, terrainFrequency: number): number {
    const wx =
      x +
      this.settings.warpStrength *
        (this.fbm2(
          this.settings.kWarp * x,
          this.settings.kWarp * y,
          terrainFrequency
        ) -
          INVARIANTS.NEUTRAL_CENTER_POINT);
    const wy =
      y +
      this.settings.warpStrength *
        (this.fbm2(
          this.settings.kWarp * y,
          this.settings.kWarp * x,
          terrainFrequency
        ) -
          INVARIANTS.NEUTRAL_CENTER_POINT);

    const sd = this.exclusiveSignedDistance(wx, wy, terrainFrequency);
    return smoothstep(-this.settings.softness, +this.settings.softness, sd);
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
    return (
      lerp(1 + clumpiness, 1 - clumpiness, maskVal) *
      ADVANCED_DIALS.COAST_FIELD_SCALE
    );
  }

  /** amt=|clumpiness|; pulls base toward C by half, scaled by amt */
  public blendElevation(base: number, C: number, amt: number): number {
    return base + ADVANCED_DIALS.COAST_FIELD_SCALE * amt * (C - base);
  }

  // --- internals (line version) --- //

  /** one-winner SDF among all line “tubes” */
  private exclusiveSignedDistance(
    x: number,
    y: number,
    terrainFrequency: number
  ): number {
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
      if (d < dBest) {
        dBest = d;
        tBest = t;
      }
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
    const radiusT =
      baseR * (this.settings.bellBase + this.settings.bellGain * bellCentering);

    // Ripple using fbm2 (domain-warp-friendly), respectful of terrainFrequency and kWarp
    const rippleNoise =
      this.settings.ripple *
      (this.fbm2(
        this.settings.kWarp * px,
        this.settings.kWarp * py,
        terrainFrequency
      ) -
        INVARIANTS.NEUTRAL_CENTER_POINT);
    // Signed distance to noisy tube
    return dist - (radiusT + rippleNoise);
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
  private refineT(
    L: LineClump,
    x: number,
    y: number,
    t0: number,
    h: number
  ): number {
    const tL = clamp(t0 - h);
    const tC = clamp(t0);
    const tR = clamp(t0 + h);

    const dL = this.distAt(L, x, y, tL);
    const dC = this.distAt(L, x, y, tC);
    const dR = this.distAt(L, x, y, tR);

    const denom = dL - 2 * dC + dR;
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
    const n2 = this.noise2D(
      (2 * x) / terrainFrequency,
      (2 * y) / terrainFrequency
    );
    return clamp(
      INVARIANTS.NEUTRAL_CENTER_POINT +
        this.settings.fbmW1 * n1 +
        this.settings.fbmW2 * n2
    );
  };
}
