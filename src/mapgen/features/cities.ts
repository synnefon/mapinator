import { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { makeRNG, type RNG } from "../../common/random";
import { CITY } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { NameGenerator } from "../NameGenerator";
import { coastDistance, waterHopDistance } from "./adjacency";
import { cityProfile } from "./cityStats";
import type { Country } from "./countries";
import { detectComponents } from "./detect";

export type CityTier = "big" | "medium" | "small";

/** A city marker: a point inside a country, sized + zoom-gated by tier, with a generated name and an
 *  estimated population (its slice of the country's urban total). `anchor` is a unit-sphere point.
 *  Carries the displayable extras the click card shows: owning country, industries, elevation, fun fact. */
export type City = {
  name: string;
  anchor: Vec3;
  cell: number; // the base-map cell the city sits on (the anchor itself may be nudged shoreward for display)
  population: number;
  tier: CityTier;
  isCapital: boolean;
  minLevel: number; // lowest LOD zoom level the marker shows at (big 1, medium 2, small 3)
  countryIndex: number;
  countryName: string; // owning country's name — for the "(capital of …)" card line
  industries: string[]; // 1–3 leading industries (biome + government tags + size + water proximity)
  elevationMeters: number; // realistic elevation, Mount-Everest-anchored
  funFact: string; // short, deterministic flavour line
};

// Tiering grounded in ~1400 sizes: a handful of "great cities" (≳75k — Paris, Cairo, Hangzhou…), a
// band of sizeable towns, and many small market towns. The capital is always big (politically primary),
// however modest. Below the floor it's a village, not a marked city. All tunable.
const BIG_POP = 75_000;
const MEDIUM_POP = 20_000;
const MIN_CITY_POP = 5_000;
// The small market town at the BOTTOM of the urban hierarchy — where the rank-size tail bottoms out. The
// largest city ≈ urbanPop / H(urbanPop / TYPICAL_TOWN_POP), so LOWER ⇒ a more primate (bigger) capital,
// higher ⇒ a flatter spread. ~1400 market towns ran a few thousand people.
const TYPICAL_TOWN_POP = 4_000;
const TIER_MIN_LEVEL: Record<CityTier, number> = { big: 1, medium: 2, small: 3 };

const MAX_CITIES_PER_COUNTRY = 16;
const CITY_COUNT_SCALE = 250_000; // city count ≈ √(urban population / scale); larger ⇒ fewer cities
// The urban fraction the count scale is calibrated at: at this fraction the count matches the original
// √(country population / scale), so the default map is unchanged while raising URBAN_FRACTION adds cities.
const URBAN_FRACTION_REF = 0.1;
const MAX_PLACEMENT_TRIES = 5; // distinct sites a city slot tries before giving up (too-high ground)
// The capital is one of the largest few cities, with these odds by size rank (biggest first).
const CAPITAL_RANK_WEIGHTS = [0.5, 0.25, 0.125, 0.125];

// Coastal pull: on Earth ~40% of people live within 100 km of the coast and ~15% within 10 km (on just
// ~4% of land), so cities cluster hard by the sea. We weight a cell's chance of hosting a city by its
// distance — in cell hops — to the nearest water, decaying over COAST_FALLOFF hops. SPREAD2 then pushes
// chosen cities apart so they string along the coast instead of stacking on the single best spot.
const COASTAL_PULL = 8; // a shore cell is up to X times as likely to host a city as the deep interior
const COAST_FALLOFF = 1.2; // hops over which the coastal pull decays (tighter ⇒ cities hug the water)
const SPREAD2 = 0.0025; // squared-chord spacing (~0.07 rad ≈ 450 km) the spread suppression falls off over

// A water body counts as "large" (a sea/ocean, not a lake/pond) if it's the biggest water body OR spans
// at least this fraction of all cells. Maritime industry + flavour key off proximity to large water, so a
// city one hop from a pond isn't "coastal". Resolution-independent (a fraction of the cell count).
const LARGE_WATER_FRAC = 0.01;

// A coastal city's marker slides this fraction from its cell centre toward the bordering sea, so it sits
// on the shore rather than a hex-centre inland. The shared land/water edge is ~halfway, so <0.5 stays on land.
const SHORE_PULL = 0.45;

const tierOf = (population: number, isCapital: boolean): CityTier =>
  isCapital || population >= BIG_POP ? "big" : population >= MEDIUM_POP ? "medium" : "small";

const siteVec = (map: GlobeMap, cell: number): Vec3 => ({
  x: map.sites[3 * cell],
  y: map.sites[3 * cell + 1],
  z: map.sites[3 * cell + 2],
});

/** A city marker position: a coastal cell's centre nudged toward its bordering large-water cells (so the
 *  marker sits on the shore, not a hex-centre inland); a cell that touches no large water keeps its centre. */
const coastAnchor = (map: GlobeMap, adjacency: number[][], cell: number, largeWater: Uint8Array): Vec3 => {
  const c = siteVec(map, cell);
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const nb of adjacency[cell]) {
    if (largeWater[nb] !== 1) continue;
    sx += map.sites[3 * nb];
    sy += map.sites[3 * nb + 1];
    sz += map.sites[3 * nb + 2];
    n++;
  }
  if (n === 0) return c; // not on a large-water shore — keep the cell centre
  // Lerp the centre toward the mean of the bordering sea cells (≈ the shoreline), then re-project to the sphere.
  return Vec3.normalize({
    x: c.x + SHORE_PULL * (sx / n - c.x),
    y: c.y + SHORE_PULL * (sy / n - c.y),
    z: c.z + SHORE_PULL * (sz / n - c.z),
  });
};

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
  const largeWater = largeWaterMask(map, seaLevel, adjacency);
  const seaDist = waterHopDistance(map, seaLevel, adjacency, (i) => largeWater[i] === 1);
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
    // City COUNT scales with the URBAN population (not just total), so dialing URBAN_FRACTION up grows
    // both the number of cities AND (via urbanPop's rank-size split in placeCities) their size.
    // Dividing by URBAN_FRACTION_REF keeps the default fraction at the original √(population/scale) count.
    const nCities = Math.min(
      MAX_CITIES_PER_COUNTRY,
      cells.length,
      Math.max(1, Math.round(Math.sqrt(urbanPop / (CITY_COUNT_SCALE * URBAN_FRACTION_REF))))
    );
    // `placed` is size-ordered (largest first). A slot with no low-enough site after MAX_PLACEMENT_TRIES
    // is dropped, so a country with nowhere habitable simply gets no city.
    const placed = placeCities(map, cells, coastDist, elevCap, nCities, urbanPop, rng);
    if (placed.length === 0) continue;
    const capitalIdx = pickWeightedRank(CAPITAL_RANK_WEIGHTS, placed.length, rng);
    const usedFunFacts = new Set<string>(); // dedupe fun facts within this country

    placed.forEach(({ cell, population }, idx) => {
      const isCapital = idx === capitalIdx;
      if (!isCapital && population < MIN_CITY_POP) return; // a village, not a marked city
      const tier = tierOf(population, isCapital);
      // Name is globally unique (the namer re-rolls on collision); stats are seeded on a SEPARATE stream
      // so adding them never shifts placement/population (which consume the per-country `rng` above).
      const name = namer.generate({ seed: `${mapSeed}|city|${country.index}|${idx}`, lang: country.language, unique: true });
      const profile = cityProfile({
        rawElevation: map.elevation[cell],
        reportElevation: map.reportElevation[cell],
        moisture: map.moisture[cell],
        rainfall: map.rainfall,
        ice: map.ice[cell],
        seaLevel,
        coastDist: coastDist[cell],
        seaDist: seaDist[cell],
        population,
        tier,
        isCapital,
        govTags: country.govType.tags,
        countryName: country.name,
        usedFunFacts,
        rng: makeRNG(`${mapSeed}|city-stats|${country.index}|${idx}`),
      });
      cities.push({
        name,
        anchor: coastAnchor(map, adjacency, cell, largeWater),
        cell,
        population,
        tier,
        isCapital,
        minLevel: TIER_MIN_LEVEL[tier],
        countryIndex: country.index,
        countryName: country.name,
        industries: profile.industries,
        elevationMeters: profile.elevationMeters,
        funFact: profile.funFact,
      });
    });
  }
  return cities;
}

/** Per-cell flag (1/0): is this cell part of a LARGE water body? The single biggest water component
 *  always counts (these worlds always have an ocean); others count once they clear LARGE_WATER_FRAC. */
function largeWaterMask(map: GlobeMap, seaLevel: number, adjacency: number[][]): Uint8Array {
  const mask = new Uint8Array(map.cellCount);
  const water = detectComponents(map, seaLevel, adjacency).filter((c) => c.cls === "water");
  if (water.length === 0) return mask;
  const threshold = LARGE_WATER_FRAC * map.cellCount;
  const largest = water.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  for (const comp of water) {
    if (comp === largest || comp.cells.length >= threshold) {
      for (const cell of comp.cells) mask[cell] = 1;
    }
  }
  return mask;
}

/** Per-cell cap on the biggest city a cell may host: 2 = any, 1 = small only (HIGH ground), 0 = none
 *  (VERY_HIGH peaks + non-land). Derived from the same elevations the renderer colours by. */
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

// Harmonic number Hₘ = Σ_{k=1}^{m} 1/k, closed-form via the Euler–Maclaurin asymptotic (γ = Euler–
// Mascheroni constant); O(1) and exact enough above m=1, so the rank-size normaliser scales to a huge
// settlement hierarchy without a giant loop.
const harmonicNumber = (m: number): number =>
  m <= 1 ? m : Math.log(m) + 0.5772156649 + 1 / (2 * m) - 1 / (12 * m * m);

/**
 * Place one country's cities and size them by rank-size (city k gets urbanPop / (k · H), H the harmonic
 * number of the FULL settlement hierarchy — not just the emitted n — so sizes stay period-realistic). Each slot is
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
  // Rank-size (Zipf) over the FULL urban hierarchy, not just the n cities we emit: a country's urban
  // population spreads across ~urbanPop/TYPICAL_TOWN_POP settlements down to small market towns, so we
  // normalise by the harmonic number of THAT count. Emitting only the top n then gives realistic ~1400
  // absolute sizes (the largest grows sub-linearly with country size) instead of cramming every urban
  // dweller into ≤16 cities and inflating them.
  const settlements = Math.max(n, Math.round(urbanPop / TYPICAL_TOWN_POP));
  const harmonic = harmonicNumber(settlements);
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
