import { makeRNG, type RNG } from "../../common/random";
import type { TerrainParams } from "../../common/settings";

// Mirror of Tectonics' private build (Tectonics.ts: TECTONIC_SEED_SUFFIX + ensureBuilt + randomUnit),
// extracted so the GPU can upload the SAME plate seeds + Euler poles the CPU uses → identical mountain
// placement. K is tiny (PLATE_COUNT, ~22), uploaded as uniform vec3 arrays. A test pins this to
// Tectonics.seeds() so the two builds can't drift.
const TECTONICS_SEED_SUFFIX = "/tectonics";

function randomUnit(rng: RNG): [number, number, number] {
  const z = 2 * rng() - 1;
  const t = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(t), r * Math.sin(t), z];
}

export type PlateData = {
  count: number;
  seeds: Float32Array; // 3 per plate: unit seed positions
  poles: Float32Array; // 3 per plate: Euler-pole (drift) axes
};

/** Build the plate seed + Euler-pole set for `seed`/`params`, identical to Tectonics' internal build
 *  (same seeded RNG, same interleaving: per plate a seed `randomUnit` then a pole `randomUnit`). */
export function buildPlateData(seed: string, params: TerrainParams): PlateData {
  const count = Math.max(2, Math.round(params.TECTONICS.PLATE_COUNT));
  const rng = makeRNG(seed + TECTONICS_SEED_SUFFIX);
  const seeds = new Float32Array(3 * count);
  const poles = new Float32Array(3 * count);
  for (let i = 0; i < count; i++) {
    const s = randomUnit(rng);
    seeds[3 * i] = s[0];
    seeds[3 * i + 1] = s[1];
    seeds[3 * i + 2] = s[2];
    const a = randomUnit(rng);
    poles[3 * i] = a[0];
    poles[3 * i + 1] = a[1];
    poles[3 * i + 2] = a[2];
  }
  return { count, seeds, poles };
}
