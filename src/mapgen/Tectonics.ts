import type { NoiseFunction3D } from "simplex-noise";
import { makeRNG, type RNG } from "../common/random";
import type { TerrainParams } from "../common/settings";
import { smoothstep } from "../common/util";

// Decorrelate the plate RNG stream from the terrain noise (same world seed, different stream).
const TECTONIC_SEED_SUFFIX = "/tectonics";

// Ramp width (in convergence units) above CONVERGENCE_THRESHOLD to a full-height range: nothing
// rises below the threshold, the range is full by threshold + this, graded between (so stronger
// collisions make taller ranges). Fixed — a second-order knob, not worth a dial.
const CONVERGENCE_SOFTNESS = 0.4;

// Width (in seed-dot units) over which a range FADES to nothing approaching a triple junction —
// the seam where the 2nd- and 3rd-nearest plates tie, so the boundary's far side (and thus the
// convergence) switches discontinuously. Ramping both sides to 0 at the seam turns the old hard
// cut into a smooth gap. Fixed second-order knob.
const JUNCTION_FADE_WIDTH = 0.06;

// SINUOSITY warps the lookup position so plate boundaries meander instead of running as dead-straight
// great-circle arcs. WARP_WAVELENGTH sets the meander scale; the offsets decorrelate the components.
const WARP_WAVELENGTH = 0.7;
const WARP_OFFSET_X = 8.3;
const WARP_OFFSET_Y = 27.1;
const WARP_OFFSET_Z = 53.9;

// Plate-motion arrow sampling (the "tectonic plates" overlay) — a viz layer, so its own knobs.
const ARROW_SAMPLES = 2400; // even fibonacci probes; the leading-edge subset become arrows
const ARROW_BAND = 0.05; // keep probes within this geodesic distance (rad) of a plate boundary
const ARROW_MIN_SPEED = 1e-3; // skip where |ω×p| ≈ 0 (a plate's Euler pole — no defined direction)
const ARROW_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A uniform random point on the unit sphere (also reused for random Euler-pole axes). */
function randomUnit(rng: RNG): { x: number; y: number; z: number } {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: r * Math.cos(t), y: r * Math.sin(t), z };
}

/**
 * Fake plate tectonics for mountain PLACEMENT — what makes ranges read as CHAINS instead of the
 * round blobs an isotropic noise mask gives. Scatter K plate seeds on the unit sphere (a spherical
 * Voronoi partition) and give each plate a rigid rotation (an Euler pole = its drift). Where two
 * plates push TOGETHER across their shared boundary (convergent), crust piles up → a long, linear
 * range runs ALONG that boundary arc; divergent / transform boundaries and plate interiors stay flat.
 *
 * `upliftAt` returns a [0,1] placement weight the ElevationCalculator uses exactly like the old
 * noise mask (it multiplies SWELL + ridged peaks). It's a pure function of position after the
 * per-seed build, so it costs nothing extra at zoom and the LOD/zoom story is unchanged. Boundaries
 * are decorrelated from the continent carrier, so the "CONTINENT owns land/water, mountains only
 * ADD" invariant holds — ocean cells are gated out upstream by `inland`.
 */
export class Tectonics {
  private readonly seed: string;
  private readonly noise3D: NoiseFunction3D;
  private readonly params: TerrainParams;
  private count = 0;
  // Plate seed unit vectors + Euler-pole (angular-velocity) vectors — parallel arrays of length count.
  private sx = new Float64Array(0);
  private sy = new Float64Array(0);
  private sz = new Float64Array(0);
  private wx = new Float64Array(0);
  private wy = new Float64Array(0);
  private wz = new Float64Array(0);

  constructor(seed: string, noise3D: NoiseFunction3D, params: TerrainParams) {
    this.seed = seed;
    this.noise3D = noise3D;
    this.params = params;
  }

  /** Domain-warp the lookup position so plate boundaries meander instead of running as dead-straight
   *  great-circle arcs, then re-project onto the unit sphere (the boundary-distance + convergence
   *  math assume |p| = 1). Shared by upliftAt + plateAt so the ranges and the plate overlay agree. */
  private warp(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const s = this.params.TECTONIC.SINUOSITY;
    if (s <= 0) return { x, y, z };
    const wl = WARP_WAVELENGTH;
    const wx = x + s * this.noise3D(x / wl + WARP_OFFSET_X, y / wl + WARP_OFFSET_X, z / wl + WARP_OFFSET_X);
    const wy = y + s * this.noise3D(x / wl + WARP_OFFSET_Y, y / wl + WARP_OFFSET_Y, z / wl + WARP_OFFSET_Y);
    const wz = z + s * this.noise3D(x / wl + WARP_OFFSET_Z, y / wl + WARP_OFFSET_Z, z / wl + WARP_OFFSET_Z);
    const len = Math.hypot(wx, wy, wz) || 1;
    return { x: wx / len, y: wy / len, z: wz / len };
  }

  /** (Re)build the plate set when PLATE_COUNT changes — deterministic from the seed, so the same
   *  seed + count always yields the same plates. K is tiny, so the rebuild is cheap. */
  private ensureBuilt(): void {
    const k = Math.max(2, Math.round(this.params.TECTONIC.PLATE_COUNT));
    if (k === this.count) return;
    const rng = makeRNG(this.seed + TECTONIC_SEED_SUFFIX);
    this.count = k;
    this.sx = new Float64Array(k);
    this.sy = new Float64Array(k);
    this.sz = new Float64Array(k);
    this.wx = new Float64Array(k);
    this.wy = new Float64Array(k);
    this.wz = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      const s = randomUnit(rng);
      this.sx[i] = s.x;
      this.sy[i] = s.y;
      this.sz[i] = s.z;
      // Euler pole: a random unit axis → this plate's rigid drift, velocity field ω × p. All plates
      // spin at the same rate; the random axes alone give the variety in how boundaries collide.
      const axis = randomUnit(rng);
      this.wx[i] = axis.x;
      this.wy[i] = axis.y;
      this.wz[i] = axis.z;
    }
  }

  /** Which plate a point belongs to: the index of its nearest plate seed. A pure function of
   *  position after the per-seed build — used by the render-time tectonic-plate overlay. */
  public plateAt(x: number, y: number, z: number): number {
    this.ensureBuilt();
    const w = this.warp(x, y, z);
    x = w.x;
    y = w.y;
    z = w.z;
    let iA = 0;
    let dA = -Infinity;
    for (let i = 0; i < this.count; i++) {
      const d = x * this.sx[i] + y * this.sy[i] + z * this.sz[i];
      if (d > dA) {
        dA = d;
        iA = i;
      }
    }
    return iA;
  }

  /** Plate seed positions as a flat [x,y,z,…] array, one per plate. Exposed for tests that
   *  independently check boundary geometry. */
  public seeds(): Float32Array {
    this.ensureBuilt();
    const k = this.count;
    const out = new Float32Array(3 * k);
    for (let i = 0; i < k; i++) {
      out[3 * i] = this.sx[i];
      out[3 * i + 1] = this.sy[i];
      out[3 * i + 2] = this.sz[i];
    }
    return out;
  }

  /**
   * Sample plate-motion arrows along the LEADING edges of plates, for the "tectonic plates" overlay.
   * Even fibonacci probes over the sphere, kept where they (a) hug a plate boundary and (b) the
   * owning plate is ADVANCING across it (velocity · outward-normal > 0 — the front of the plate's
   * drift, not its trailing edge). Returns flat [x,y,z,…] tail positions + unit tangent directions
   * (the plate's surface velocity ω×p). Uses the SAME domain warp as plateAt/upliftAt, so arrows
   * land on the meandering boundaries the overlay actually draws. Pure function of the per-seed
   * build, so the caller memoizes it.
   */
  public boundaryArrows(): { positions: Float32Array; directions: Float32Array } {
    this.ensureBuilt();
    const positions: number[] = [];
    const directions: number[] = [];
    for (let s = 0; s < ARROW_SAMPLES; s++) {
      // Fibonacci-sphere probe — the REAL surface point where the arrow is drawn.
      const pz = 1 - (2 * s + 1) / ARROW_SAMPLES;
      const rr = Math.sqrt(Math.max(0, 1 - pz * pz));
      const phi = s * ARROW_GOLDEN_ANGLE;
      const px = rr * Math.cos(phi);
      const py = rr * Math.sin(phi);

      // Warp picks the owner + boundary, matching the colour overlay's meandering boundaries.
      const w = this.warp(px, py, pz);
      let iA = 0;
      let iB = 0;
      let dA = -Infinity;
      let dB = -Infinity;
      for (let i = 0; i < this.count; i++) {
        const d = w.x * this.sx[i] + w.y * this.sy[i] + w.z * this.sz[i];
        if (d > dA) {
          dB = dA;
          iB = iA;
          dA = d;
          iA = i;
        } else if (d > dB) {
          dB = d;
          iB = i;
        }
      }
      // Geodesic distance to the boundary (bisector great circle); keep only the thin belt.
      const cx = this.sx[iB] - this.sx[iA];
      const cy = this.sy[iB] - this.sy[iA];
      const cz = this.sz[iB] - this.sz[iA];
      const chordLen = Math.hypot(cx, cy, cz) || 1;
      const dist = Math.asin(Math.min(1, Math.abs(w.x * cx + w.y * cy + w.z * cz) / chordLen));
      if (dist > ARROW_BAND) continue;

      // Boundary normal n̂ at the real point: the chord (A→B) projected into its tangent plane.
      let nx = cx;
      let ny = cy;
      let nz = cz;
      const ndp = nx * px + ny * py + nz * pz;
      nx -= ndp * px;
      ny -= ndp * py;
      nz -= ndp * pz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;

      // Owning plate A's surface velocity at the point: ωA × p (tangent to the sphere).
      const ax = this.wx[iA];
      const ay = this.wy[iA];
      const az = this.wz[iA];
      const vx = ay * pz - az * py;
      const vy = az * px - ax * pz;
      const vz = ax * py - ay * px;
      const vl = Math.hypot(vx, vy, vz);
      if (vl < ARROW_MIN_SPEED) continue;
      // LEADING edge only: keep it where A is advancing across the boundary (toward B); drop the
      // trailing side where it's receding (v · n̂ ≤ 0).
      if (vx * nx + vy * ny + vz * nz <= 0) continue;

      positions.push(px, py, pz);
      directions.push(vx / vl, vy / vl, vz / vl);
    }
    return {
      positions: new Float32Array(positions),
      directions: new Float32Array(directions),
    };
  }

  /**
   * Mountain placement weight in [0,1] AND owning plate at a unit-sphere point, in ONE pass: the
   * weight is high along CONVERGENT plate boundaries (where ranges form), tapering to 0 across the
   * RANGE_WIDTH belt, and 0 on divergent / transform boundaries and in plate interiors; `plate` is
   * the nearest plate seed. upliftAt + plateAt each redo the SAME warp + nearest-plate scan, so a
   * per-cell sample (which needs both) shares them here — dropping a redundant warp (3 noise lookups)
   * + scan per land cell. The uplift is bit-identical to upliftAt, the plate to plateAt.
   */
  public upliftAndPlateAt(x: number, y: number, z: number): { uplift: number; plate: number } {
    this.ensureBuilt();
    const w = this.warp(x, y, z);
    x = w.x;
    y = w.y;
    z = w.z;
    // Nearest two plate seeds by cosine (unit vectors → dot = cos angular distance, so the LARGEST
    // dot is the nearest seed). The cell belongs to plate A; B owns the far side of the boundary.
    let iA = 0;
    let iB = 0;
    let dA = -Infinity;
    let dB = -Infinity;
    let dC = -Infinity; // 3rd-nearest dot — for the triple-junction fade below
    for (let i = 0; i < this.count; i++) {
      const d = x * this.sx[i] + y * this.sy[i] + z * this.sz[i];
      if (d > dA) {
        dC = dB;
        dB = dA;
        iB = iA;
        dA = d;
        iA = i;
      } else if (d > dB) {
        dC = dB;
        dB = d;
        iB = i;
      } else if (d > dC) {
        dC = d;
      }
    }
    // Exact geodesic distance to the boundary great circle (the perpendicular bisector of A & B):
    // its plane normal is the chord between the two seeds, so distance = asin(|p·chord| / |chord|).
    // (The old 0.5·(θB−θA) under-read away from the seed midpoint, ballooning belts toward their ends.)
    let nx = this.sx[iB] - this.sx[iA]; // chord (B − A) = the boundary-plane normal, up to sign
    let ny = this.sy[iB] - this.sy[iA];
    let nz = this.sz[iB] - this.sz[iA];
    const chordLen = Math.hypot(nx, ny, nz) || 1;
    const dist = Math.asin(Math.min(1, Math.abs(x * nx + y * ny + z * nz) / chordLen));
    const reach = Math.max(0.5 * this.params.TECTONIC.RANGE_WIDTH, 1e-6);
    const band = 1 - smoothstep(0, reach, dist);
    if (band <= 0) return { uplift: 0, plate: iA }; // plate interior → no range (skip the convergence math)

    // Reuse that chord as the boundary normal: project it into the tangent plane at p and normalize
    // — it points across the boundary (A → B), so velocity along it measures approach.
    const ndp = nx * x + ny * y + nz * z;
    nx -= ndp * x;
    ny -= ndp * y;
    nz -= ndp * z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;

    // Relative plate velocity at p: (ωA − ωB) × p (a cross product with p, so it's tangent to the
    // sphere). Its component across the boundary (· n̂) is the convergence: + = colliding (mountains),
    // − = rifting apart, ≈0 = sliding past (transform).
    const rwx = this.wx[iA] - this.wx[iB];
    const rwy = this.wy[iA] - this.wy[iB];
    const rwz = this.wz[iA] - this.wz[iB];
    const vx = rwy * z - rwz * y;
    const vy = rwz * x - rwx * z;
    const vz = rwx * y - rwy * x;
    const convergence = vx * nx + vy * ny + vz * nz;

    // Fade the range to nothing along the seam where the 2nd-/3rd-nearest plates tie (a triple
    // junction): there the boundary's far side — and thus the convergence and normal — switch
    // discontinuously. Ramping both sides to 0 at the seam turns that hard cut into a smooth gap.
    const junction = smoothstep(0, JUNCTION_FADE_WIDTH, dB - dC);
    // Only convergent boundaries raise ranges: nothing below THRESHOLD, full height by THRESHOLD +
    // CONVERGENCE_SOFTNESS, graded between (stronger collisions → taller ranges). band then tapers
    // the range out across its width.
    const uplift =
      smoothstep(
        this.params.TECTONIC.CONVERGENCE_THRESHOLD,
        this.params.TECTONIC.CONVERGENCE_THRESHOLD + CONVERGENCE_SOFTNESS,
        convergence
      ) * band * junction;
    return { uplift, plate: iA };
  }

  /** Mountain placement weight only — a thin wrapper over upliftAndPlateAt for callers that don't
   *  need the plate (the hillshade slope samples at offset points). */
  public upliftAt(x: number, y: number, z: number): number {
    return this.upliftAndPlateAt(x, y, z).uplift;
  }
}
