import { createNoise3D } from "simplex-noise";
import { describe, expect, it } from "vitest";
import { makeRNG } from "../../common/random";
import { buildPermTextureData } from "./permTable";

// Oracle: the EXACT simplex-noise 3D algorithm, in float64 JS, reading the packed perm/gradient
// texture data. This is the line-for-line twin of the GLSL `snoise` in exactSnoise.glsl.ts — so if it
// reproduces the library's noise3D bit-for-bit, the GLSL port is correct too (up to float32 rounding,
// which the /gpu-spike harness measures empirically). F3/G3 match simplex-noise.ts.
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

function snoiseFromTable(data: Float32Array, x: number, y: number, z: number): number {
  const perm = (i: number): number => data[4 * i + 3];
  const gx = (i: number): number => data[4 * i];
  const gy = (i: number): number => data[4 * i + 1];
  const gz = (i: number): number => data[4 * i + 2];

  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);

  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else {
    if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;

  const corner = (tt: number, gi: number, dx: number, dy: number, dz: number): number => {
    if (tt < 0) return 0;
    const t2 = tt * tt;
    return t2 * t2 * (gx(gi) * dx + gy(gi) * dy + gz(gi) * dz);
  };
  const n0 = corner(0.6 - x0 * x0 - y0 * y0 - z0 * z0, ii + perm(jj + perm(kk)), x0, y0, z0);
  const n1 = corner(0.6 - x1 * x1 - y1 * y1 - z1 * z1, ii + i1 + perm(jj + j1 + perm(kk + k1)), x1, y1, z1);
  const n2 = corner(0.6 - x2 * x2 - y2 * y2 - z2 * z2, ii + i2 + perm(jj + j2 + perm(kk + k2)), x2, y2, z2);
  const n3 = corner(0.6 - x3 * x3 - y3 * y3 - z3 * z3, ii + 1 + perm(jj + 1 + perm(kk + 1)), x3, y3, z3);
  return 32 * (n0 + n1 + n2 + n3);
}

describe("buildPermTextureData", () => {
  it("reproduces the library's noise3D bit-for-bit (proves the algorithm + table port)", () => {
    for (const seed of ["ATLANTIS", "PANGAEA", "x", "the quick brown fox"]) {
      const noise3D = createNoise3D(makeRNG(seed));
      const data = buildPermTextureData(seed);
      const rng = makeRNG(`${seed}-samplepoints`);
      for (let s = 0; s < 500; s++) {
        // Cover the coordinate ranges the field uses: unit-sphere xyz scaled by small wavelengths.
        const x = (rng() * 2 - 1) * 60;
        const y = (rng() * 2 - 1) * 60;
        const z = (rng() * 2 - 1) * 60;
        expect(snoiseFromTable(data, x, y, z)).toBe(noise3D(x, y, z));
      }
    }
  });

  it("is the right size and packs perm into [0,255]", () => {
    const data = buildPermTextureData("ATLANTIS");
    expect(data.length).toBe(512 * 4);
    for (let i = 0; i < 512; i++) {
      const p = data[4 * i + 3];
      expect(Number.isInteger(p)).toBe(true);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(255);
    }
  });
});
