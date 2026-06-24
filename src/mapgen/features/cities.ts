import type { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { makeRNG, type RNG } from "../../common/random";
import { CITY } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { NameGenerator } from "../NameGenerator";
import type { Country } from "./countries";

export type CityTier = "big" | "medium" | "small";

/** A city marker: a point inside a country, sized + zoom-gated by tier, with a generated name and an
 *  estimated population (its slice of the country's urban total). `anchor` is a unit-sphere point. */
export type City = {
  name: string;
  anchor: Vec3;
  population: number;
  tier: CityTier;
  isCapital: boolean;
  minLevel: number; // lowest LOD zoom level the marker shows at (big 1, medium 2, small 3)
  countryIndex: number;
};

// Tiering grounded in ~1400 sizes: a handful of "great cities" (≳75k — Paris, Cairo, Hangzhou…), a
// band of sizeable towns, and many small market towns. The capital is always big (politically primary),
// however modest. Below the floor it's a village, not a marked city. All tunable.
const BIG_POP = 75_000;
const MEDIUM_POP = 20_000;
const MIN_CITY_POP = 5_000;
const TIER_MIN_LEVEL: Record<CityTier, number> = { big: 1, medium: 2, small: 3 };

const MAX_CITIES_PER_COUNTRY = 16;
const CITY_COUNT_SCALE = 250_000; // city count ≈ √(country population / scale); larger ⇒ fewer cities
const MAX_PLACEMENT_TRIES = 5; // distinct sites a city slot tries before giving up (too-high ground)
// The capital is one of the largest few cities, with these odds by size rank (biggest first).
const CAPITAL_RANK_WEIGHTS = [0.5, 0.25, 0.125, 0.125];

// Coastal pull: on Earth ~40% of people live within 100 km of the coast and ~15% within 10 km (on just
// ~4% of land), so cities cluster hard by the sea. We weight a cell's chance of hosting a city by its
// distance — in cell hops — to the nearest water, decaying over COAST_FALLOFF hops. SPREAD2 then pushes
// chosen cities apart so they string along the coast instead of stacking on the single best spot.
const COASTAL_PULL = 8; // a shore cell is up to ~9× as likely to host a city as the deep interior
const COAST_FALLOFF = 1.5; // hops over which the coastal pull decays
const SPREAD2 = 0.0025; // squared-chord spacing (~0.07 rad ≈ 450 km) the spread suppression falls off over

const tierOf = (population: number, isCapital: boolean): CityTier =>
  isCapital || population >= BIG_POP ? "big" : population >= MEDIUM_POP ? "medium" : "small";

const siteVec = (map: GlobeMap, cell: number): Vec3 => ({
  x: map.sites[3 * cell],
  y: map.sites[3 * cell + 1],
  z: map.sites[3 * cell + 2],
});

/**
 * Place + size the cities of every country. Each country devotes CITY.URBAN_FRACTION of its people to
 * cities; that urban total is split across them by a rank-size (Zipf) rule — the largest leads, each
 * next ≈ 1/rank of it. Sites are sampled coastal-weighted (Earth concentrates people on coasts), spread
 * so they don't clump, and kept off high ground (no city on VERY_HIGH peaks; only small cities on HIGH).
 * The CAPITAL is then one of the largest few (50% the biggest, then 25% / 12.5% / 12.5%) — usually, but
 * not always, the biggest city. Deterministic (seeded). Run on the base globe.
 */
export function assignCities(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  countryOf: Int32Array,
  countries: Country[],
  mapSeed: string,
  namer: NameGenerator
): City[] {
  const coastDist = coastDistance(map, seaLevel, adjacency);
  const elevCap = elevationCaps(map);
  const urbanFraction = CITY.URBAN_FRACTION.value;

  // Group land cells by country (ocean / uninhabited cells are -1).
  const cellsByCountry: number[][] = countries.map(() => []);
  for (let i = 0; i < map.cellCount; i++) {
    const ci = countryOf[i];
    if (ci >= 0) cellsByCountry[ci].push(i);
  }

  const cities: City[] = [];
  for (const country of countries) {
    const cells = cellsByCountry[country.index];
    if (cells.length === 0) continue;
    const rng = makeRNG(`${mapSeed}|cities|${country.index}`);

    const urbanPop = urbanFraction * country.population;
    const nCities = Math.min(
      MAX_CITIES_PER_COUNTRY,
      cells.length,
      Math.max(1, Math.round(Math.sqrt(country.population / CITY_COUNT_SCALE)))
    );
    // `placed` is size-ordered (largest first). A slot with no low-enough site after MAX_PLACEMENT_TRIES
    // is dropped, so a country with nowhere habitable simply gets no city.
    const placed = placeCities(map, cells, coastDist, elevCap, nCities, urbanPop, rng);
    if (placed.length === 0) continue;
    const capitalIdx = pickWeightedRank(CAPITAL_RANK_WEIGHTS, placed.length, rng);

    placed.forEach(({ cell, population }, idx) => {
      const isCapital = idx === capitalIdx;
      if (!isCapital && population < MIN_CITY_POP) return; // a village, not a marked city
      const tier = tierOf(population, isCapital);
      cities.push({
        name: namer.generate({ seed: `${mapSeed}|city|${country.index}|${idx}`, lang: country.language }),
        anchor: siteVec(map, cell),
        population,
        tier,
        isCapital,
        minLevel: TIER_MIN_LEVEL[tier],
        countryIndex: country.index,
      });
    });
  }
  return cities;
}

/** Each land cell's distance, in graph hops, to the nearest water — a multi-source BFS out from the
 *  coastline (a land cell touching water is 0). Water cells stay -1. Used to bias cities toward coasts. */
export function coastDistance(map: GlobeMap, seaLevel: number, adjacency: number[][]): Int32Array {
  const { cellCount, elevation } = map;
  const isWater = (i: number): boolean => elevation[i] < seaLevel;
  const dist = new Int32Array(cellCount).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < cellCount; i++) {
    if (isWater(i)) continue;
    for (const nb of adjacency[i]) {
      if (isWater(nb)) {
        dist[i] = 0;
        queue.push(i);
        break;
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const next = dist[c] + 1;
    for (const nb of adjacency[c]) {
      if (!isWater(nb) && dist[nb] === -1) {
        dist[nb] = next;
        queue.push(nb);
      }
    }
  }
  return dist;
}

/** Per-cell cap on the biggest city a cell may host: 2 = any, 1 = small only (HIGH ground), 0 = none
 *  (VERY_HIGH peaks + non-land). Derived from the same elevation families the renderer colours by. */
export function elevationCaps(map: GlobeMap): Int8Array {
  const { cellCount, elevation, moisture, rainfall } = map;
  const cap = new Int8Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const tc = terrainClassOf(elevation[i], moisture[i], rainfall);
    cap[i] = !tc || tc.family === "VERY_HIGH" ? 0 : tc.family === "HIGH" ? 1 : 2;
  }
  return cap;
}

const coastWeight = (d: number): number =>
  d < 0 ? 1 : 1 + COASTAL_PULL * Math.exp(-d / COAST_FALLOFF);

/** Pick an index 0..min(weights.length, n)-1 with probability ∝ weights (renormalised when fewer than
 *  weights.length items exist). */
function pickWeightedRank(weights: number[], n: number, rng: RNG): number {
  const k = Math.min(weights.length, n);
  let total = 0;
  for (let i = 0; i < k; i++) total += weights[i];
  let r = rng() * total;
  for (let i = 0; i < k; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return 0;
}

/** Weighted pick over the positive-weight cells not in `skip`; -1 if none remain. */
function sampleWeighted(w: number[], skip: Set<number>, rng: RNG): number {
  let total = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && !skip.has(i)) total += w[i];
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0 || skip.has(i)) continue;
    r -= w[i];
    if (r <= 0) return i;
  }
  return -1;
}

/**
 * Place one country's cities and size them by rank-size (city k gets urbanPop / (k · Hₙ)). Each slot is
 * sampled coastal-weighted, then gated by elevation — a big/medium city needs LOW/MEDIUM ground (cap 2),
 * a small one may sit on HIGH ground (cap 1), and VERY_HIGH never hosts a city. A slot rejects too-high
 * sites and retries up to MAX_PLACEMENT_TRIES distinct spots; if none is low enough, that city is dropped.
 * Each placed city suppresses its neighbourhood so the rest spread out. Size-ordered (largest first).
 */
function placeCities(
  map: GlobeMap,
  cells: number[],
  coastDist: Int32Array,
  elevCap: Int8Array,
  n: number,
  urbanPop: number,
  rng: RNG
): { cell: number; population: number }[] {
  const { sites } = map;
  let harmonic = 0;
  for (let i = 0; i < n; i++) harmonic += 1 / (i + 1);
  const w = cells.map((c) => coastWeight(coastDist[c]));
  const placed: { cell: number; population: number }[] = [];
  for (let rank = 0; rank < n; rank++) {
    const population = Math.round(urbanPop / ((rank + 1) * harmonic));
    const needCap = population >= MEDIUM_POP ? 2 : 1; // big/medium need low ground; small may go up to HIGH
    // Try up to MAX_PLACEMENT_TRIES distinct sites; reject any too high for this size, then give up.
    const tried = new Set<number>();
    let chosen = -1;
    for (let t = 0; t < MAX_PLACEMENT_TRIES; t++) {
      const idx = sampleWeighted(w, tried, rng);
      if (idx < 0) break; // nothing left to sample
      if (elevCap[cells[idx]] >= needCap) {
        chosen = idx;
        break;
      }
      tried.add(idx); // too high for this city — try a different location
    }
    if (chosen < 0) continue; // no low-enough site in MAX_PLACEMENT_TRIES tries → no city for this slot
    const cell = cells[chosen];
    placed.push({ cell, population });
    w[chosen] = 0; // without replacement
    // Suppress the chosen cell's neighbourhood so the next city lands elsewhere along the coast.
    const ax = sites[3 * cell];
    const ay = sites[3 * cell + 1];
    const az = sites[3 * cell + 2];
    for (let i = 0; i < w.length; i++) {
      if (w[i] <= 0) continue;
      const c = cells[i];
      const dot = ax * sites[3 * c] + ay * sites[3 * c + 1] + az * sites[3 * c + 2];
      w[i] *= 1 - 0.85 * Math.exp(-(1 - dot) / SPREAD2);
    }
  }
  return placed;
}
