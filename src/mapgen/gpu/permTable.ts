import { buildPermutationTable } from "simplex-noise";
import { makeRNG } from "../../common/random";

// The exact 12-gradient table simplex-noise v4 uses internally (grad3, not exported by the package).
// Must match byte-for-byte or GPU↔CPU noise diverges. See node_modules/simplex-noise/simplex-noise.ts.
const GRAD3 = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
];

// simplex-noise builds a 512-entry permutation table (256 shuffled, then mirrored).
export const PERM_TEX_SIZE = 512;

/**
 * Build the RGBA32F texel data (512×1) that makes the GPU's snoise reproduce the CPU's `noise3D`
 * EXACTLY for `seed`. The CPU side is `createNoise3D(makeRNG(seed))`, which seeds
 * `buildPermutationTable(makeRNG(seed))` and precomputes `permGrad3{x,y,z}[i] = grad3[(perm[i]%12)*3+…]`.
 * We rebuild the identical table from the same seeded RNG and pack, per index i:
 *   texel i = (permGrad3x[i], permGrad3y[i], permGrad3z[i], perm[i]).
 * The shader reads `perm[i]` from `.a` (the nested hash) and the gradient from `.rgb` (by hashed index).
 * This is what lets a GPU-generated detail patch line up with the CPU-generated globe it nests in.
 */
export function buildPermTextureData(seed: string): Float32Array {
  const perm = buildPermutationTable(makeRNG(seed)); // Uint8Array(512), identical to the CPU noise's
  const data = new Float32Array(PERM_TEX_SIZE * 4);
  for (let i = 0; i < PERM_TEX_SIZE; i++) {
    const g = (perm[i] % 12) * 3;
    data[4 * i] = GRAD3[g];
    data[4 * i + 1] = GRAD3[g + 1];
    data[4 * i + 2] = GRAD3[g + 2];
    data[4 * i + 3] = perm[i];
  }
  return data;
}
