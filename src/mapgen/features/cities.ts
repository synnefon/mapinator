import { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { makeRNG, type RNG } from "../../common/random";
import { CITIES, POPULATION } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { NameGenerator } from "../NameGenerator";
import { coastDistance, waterHopDistance } from "./adjacency";
import { cityProfile } from "./cityStats";
import type { Country } from "./countries";
import { detectComponents } from "./detect";
import type { RiverData } from "./rivers";
import { globalCityMinPop, minLevelForPopulation } from "./settlement";

export type CityTier = "big" | "medium" | "small";

// The water a city sits on, by priority sea > large river > other water (lake/pond) > none. Drives the
// riverside/coastal flavour split and (currently) a debug tint on the marker. See assignCities.
export type CityWaterKind = "ocean" | "river" | "lake" | "none";

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
  minLevel: number; // lowest LOD zoom level the marker shows at — by population (minLevelForPopulation), so
  // the small-town tail only surfaces as you zoom in; capitals are forced to 1. See assignCities.
  countryIndex: number;
  countryName: string; // owning country's name — for the "(capital of …)" card line
  industries: string[]; // 1–3 leading industries (biome + government tags + size + water proximity)
  elevationMeters: number; // realistic elevation, Mount-Everest-anchored
  funFact: string; // short, deterministic flavour line
  waterKind: CityWaterKind; // nearest water, by priority — for the flavour split + a debug marker tint
};

// CityTier grounded in ~1400 sizes: a handful of "great cities" (≳75k — Paris, Cairo, Hangzhou…), a band
// of sizeable towns, and many small market towns. The capital is always big (politically primary), however
// modest. Tier drives the marker class + flavour/industry gating — NOT the size NOUN (settlementClass) nor
// the zoom-reveal level (minLevelForPopulation), each of which keys on population on its own thresholds.
const BIG_POP = 75_000;
const MEDIUM_POP = 20_000;
// The small market town at the BOTTOM of the urban hierarchy — where the rank-size tail bottoms out. The
// largest city ≈ urbanPop / H(urbanPop / TYPICAL_TOWN_POP), so LOWER ⇒ a more primate (bigger) capital,
// higher ⇒ a flatter spread. ~1400 market towns ran a few thousand people. Also sets how many settlements
// the hierarchy holds (urbanPop / TYPICAL_TOWN_POP), i.e. how deep the small-town tail runs.
const TYPICAL_TOWN_POP = 4_000;
// The capital is one of the largest few cities, with these odds by size rank (biggest first).
const CAPITAL_RANK_WEIGHTS = [0.5, 0.25, 0.125, 0.125];

// Cities are placed in three buckets, each RIGHT ON its feature so the marker visibly sits there (rather
// than near it): a river share, a coastal share, and an interior remainder (CITY.{RIVER,COASTAL}_FRACTION).
// SPREAD2 then pushes the chosen sites apart so they string ALONG the water instead of stacking on one spot.
const SPREAD2 = 0.0025; // squared-chord spacing (~0.07 rad ≈ 450 km) the spread suppression falls off over

// A water body counts as "large" (a sea/ocean, not a lake/pond) if it's the biggest water body OR spans
// at least this fraction of all cells. Maritime industry + flavour key off proximity to large water, so a
// city one hop from a pond isn't "coastal". Resolution-independent (a fraction of the cell count).
const LARGE_WATER_FRAC = 0.01;

// River buckets work off the DRAWN network (rivers.ts) via a spatial hash, all in base cell-spacings: a
// vertex within ON makes its cell river-eligible (the river runs through it); a placed river city snaps to
// a vertex within SNAP; the hash bucket spans GRID (≥ SNAP, so the 3×3×3 scan never misses a near vertex).
const RIVER_ON_CELLS = 0.6;
const RIVER_SNAP_CELLS = 1.0;
const RIVER_GRID_CELLS = 1.5;

// === Habitability — cities avoid deserts + ice ===
// A per-cell weight folded into EVERY placement pool, so cities prefer wetter, ice-free land. Both
// penalties are MULTIPLIERS floored above 0, so a desert / ice city stays possible, just rarer — never
// hard-excluded. Strength is dialled live by CITY.DESERT_AVERSION / CITY.ICE_AVERSION.
const DRY_MOISTURE = 0.38; // moisture below this reads as "dry"; the dryness penalty ramps in below it (0 = bone dry)
const DRY_WATER_REACH = 3; // hops to water within which the DRYNESS penalty is fully waived — desert coasts, riverbanks + oases settle freely
export const HABITABILITY_FLOOR = 0.04; // a cell never drops below this weight: the bone-dry, fully-iced far interior is rare, not banned

/** A cell's city-placement habitability ∈ [HABITABILITY_FLOOR, 1]. Two FLOORED multipliers, so neither
 *  penalty is ever absolute: a DRYNESS penalty (moisture below DRY_MOISTURE) that `nearWater` ∈ [0,1]
 *  waives toward water — a desert coast / riverbank / oasis settles freely — and an ICE penalty that
 *  bites everywhere. Pure + exported so the placement weighting is unit-testable. */
export function habitabilityWeight(
  moisture: number,
  ice: number,
  nearWater: number,
  desertAversion: number,
  iceAversion: number
): number {
  const dryness = Math.max(0, 1 - moisture / DRY_MOISTURE); // 1 = bone dry, 0 = at/above the wet threshold
  const desertFactor = 1 - desertAversion * dryness * (1 - nearWater); // dry FAR from water → penalised; near water → waived
  const iceFactor = 1 - iceAversion * ice;
  return Math.max(HABITABILITY_FLOOR, desertFactor * iceFactor);
}

const tierOf = (population: number, isCapital: boolean): CityTier =>
  isCapital || population >= BIG_POP ? "big" : population >= MEDIUM_POP ? "medium" : "small";

const siteVec = (map: GlobeMap, cell: number): Vec3 => ({
  x: map.sites[3 * cell],
  y: map.sites[3 * cell + 1],
  z: map.sites[3 * cell + 2],
});

// Marching the centre→sea arc to find the shore (fraction of the way to the sea cell's centre). The
// COARSE shared edge sits at 0.5, but the RENDERED coast is the FINE field crossing sea level, which can
// fall either side of it — so we scan out from the centre and stop at the first water sample (the coast
// nearest the cell), refining the crossing by bisection. Capped short of the sea cell's open water.
const COAST_MARCH_STEP = 0.04;
const COAST_MARCH_MAX = 0.6; // a touch past the coarse edge (0.5) — allow a modest seaward fine-coast bulge
const COAST_BISECT_STEPS = 5; // refine the land/water crossing to ≈ STEP/32 of the arc

/** A city marker position at the SHORE: from the cell centre we march toward the nearest bordering WATER
 *  cell (`isWaterTarget`) and stop just on the LAND side of where the FINE elevation field crosses sea level
 *  — the exact waterline the renderer draws (`elev >= seaLevel` per fragment). So the marker sits right at
 *  the water, never stranded out in it (the coarse cell edge often falls the wrong side of the fine coast).
 *  `isWaterTarget` selects which neighbours to head for — the sea (large water) or any water (lake too). A
 *  cell bordering no such water keeps its centre. */
const coastAnchor = (
  map: GlobeMap,
  adjacency: number[][],
  cell: number,
  isWaterTarget: (nb: number) => boolean,
  fineLandAt: (p: Vec3) => boolean
): Vec3 => {
  const c = siteVec(map, cell);
  let best = -1;
  let bestDot = -Infinity;
  for (const nb of adjacency[cell]) {
    if (!isWaterTarget(nb)) continue;
    const dot = c.x * map.sites[3 * nb] + c.y * map.sites[3 * nb + 1] + c.z * map.sites[3 * nb + 2];
    if (dot > bestDot) {
      bestDot = dot; // largest dot ⇒ smallest angle ⇒ nearest water cell
      best = nb;
    }
  }
  if (best < 0) return c; // not on this kind of shore — keep the cell centre
  const s: Vec3 = { x: map.sites[3 * best], y: map.sites[3 * best + 1], z: map.sites[3 * best + 2] };
  // The point a fraction `t` from the cell centre toward the water cell's centre, re-projected to the sphere.
  const at = (t: number): Vec3 =>
    Vec3.normalize({ x: c.x + t * (s.x - c.x), y: c.y + t * (s.y - c.y), z: c.z + t * (s.z - c.z) });
  if (!fineLandAt(c)) return c; // centre itself reads as water (a borderline cell) — leave it put
  let lo = 0; // greatest t known to be on fine LAND
  let hi = -1; // least t found on fine WATER (-1 ⇒ none within the cap)
  for (let t = COAST_MARCH_STEP; t <= COAST_MARCH_MAX + 1e-9; t += COAST_MARCH_STEP) {
    if (fineLandAt(at(t))) lo = t;
    else {
      hi = t;
      break;
    }
  }
  if (hi < 0) return at(lo); // no water within the cap — sit at the most-seaward land we verified
  for (let k = 0; k < COAST_BISECT_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (fineLandAt(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo); // just on the land side of the fine waterline — at the coast, touching the water
};

// === Drawn-river lookup: a spatial hash of the rendered network's vertices (≥ the strength floor) ===
// Cities are placed ON + snap to the rivers the renderer actually draws, so a river city visibly sits on a
// visible river. A vertex counts once its flow strength ≥ CITY.RIVER_MIN_STRENGTH (widths ∈ [0,1]); the
// river bucket then weights by strength, so big rivers + their (highest-strength) mouths win.
type RiverGrid = { pos: Float32Array; width: Float32Array; inv: number; buckets: Map<string, number[]> };

const gridKey = (gx: number, gy: number, gz: number): string => `${gx}|${gy}|${gz}`;

/** Hash the drawn river vertices (strength ≥ the floor) into a cube grid of edge `cellSize`; null if none. */
function buildRiverGrid(rivers: RiverData, cellSize: number): RiverGrid | null {
  const { positions, widths } = rivers;
  const minStrength = CITIES.RIVER_MIN_STRENGTH.value;
  const inv = 1 / cellSize;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < minStrength) continue;
    const k = gridKey(Math.round(positions[3 * i] * inv), Math.round(positions[3 * i + 1] * inv), Math.round(positions[3 * i + 2] * inv));
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  return buckets.size ? { pos: positions, width: widths, inv, buckets } : null;
}

/** Nearest drawn large-river vertex to unit point `p` within the 3×3×3 bucket neighbourhood: its squared
 *  chord distance, position, and flow strength (width) — or null if none near / no grid. */
function nearestRiverVertex(p: Vec3, grid: RiverGrid | null): { chord2: number; pt: Vec3; width: number } | null {
  if (!grid) return null;
  const { pos, width, inv, buckets } = grid;
  const gx = Math.round(p.x * inv);
  const gy = Math.round(p.y * inv);
  const gz = Math.round(p.z * inv);
  let bi = -1;
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const b = buckets.get(gridKey(gx + dx, gy + dy, gz + dz));
        if (!b) continue;
        for (const i of b) {
          const ex = pos[3 * i] - p.x;
          const ey = pos[3 * i + 1] - p.y;
          const ez = pos[3 * i + 2] - p.z;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      }
    }
  }
  return bi < 0 ? null : { chord2: best, pt: { x: pos[3 * bi], y: pos[3 * bi + 1], z: pos[3 * bi + 2] }, width: width[bi] };
}

/**
 * Place + size the cities of every country. Each country devotes POPULATION.URBAN_FRACTION of its people to
 * cities; that urban total is split across them by a rank-size (Zipf) rule — the largest leads, each next
 * ≈ 1/rank of it. Sites are placed in three buckets — ON a drawn large river (favouring mouths), AT the
 * sea/lake shore, and sprinkled across the interior — in the CITY.{RIVER,COASTAL}_FRACTION proportions
 * (Earth ~1400), spread so they don't clump, and kept off VERY_HIGH peaks. Each marker then sits right on
 * its water (river line / shoreline), so it visibly belongs there. The CAPITAL is one of the largest few
 * (50% the biggest, then 25 / 12.5 / 12.5). Deterministic (seeded). Run on the base globe.
 *
 * Because the river bucket places onto the DRAWN network, placement depends on `rivers`: an empty / late-
 * arriving (GPU-sampled) network simply yields no river cities until it lands (then a recompute re-places).
 */
export function assignCities(
  map: GlobeMap,
  reportElevation: Float32Array, // the inland-risen display elevation (see inlandRisenElevation) — passed
  // explicitly, not read off the map, so this function's dependency on the risen field is named, not implicit
  seaLevel: number,
  adjacency: number[][],
  countryOf: Int32Array,
  countries: Country[],
  mapSeed: string,
  namer: NameGenerator,
  // True iff the FINE elevation field reads as land at `p` (the same waterline the renderer draws). Lets a
  // shore marker snap to the rendered coast, not the coarser base-cell boundary. See coastAnchor.
  fineLandAt: (p: Vec3) => boolean,
  // The drawn river network. River-bucket cities are placed ON its large rivers + snap to them. EMPTY_RIVERS
  // ⇒ no river cities (e.g. before the debounced route finishes, or with no GPU float RT).
  rivers: RiverData
): City[] {
  const coastDist = coastDistance(map, seaLevel, adjacency);
  const largeWater = largeWaterMask(map, seaLevel, adjacency);
  const seaDist = waterHopDistance(map, seaLevel, adjacency, (i) => largeWater[i] === 1);
  const elevCap = elevationCaps(map);
  const urbanFraction = POPULATION.URBAN_FRACTION.value;
  // The live global/patch split: at/above this a city shows globally; the dense sub-threshold tail is the
  // patch-local town layer. Scales with density so the global (static-marker) count stays bounded. The
  // RegionTownLayer computes the SAME value for its ceiling, so the two meet with no gap or overlap.
  const cityMinPop = globalCityMinPop(POPULATION.GLOBAL_POPULATION_DENSITY.value);

  // The drawn large-river network (rivers.ts), hashed for fast nearest-vertex lookup. `riverStrength[c]` is
  // the flow strength of the large river running THROUGH cell c (0 = none) — the river bucket's pool +
  // weight (bigger ⇒ likelier, and strength peaks at the mouth, so mouths are favoured). All in cell-spacings.
  const cellSpacing = Math.sqrt((4 * Math.PI) / map.cellCount);
  const riverGrid = buildRiverGrid(rivers, RIVER_GRID_CELLS * cellSpacing);
  const onRiver2 = (RIVER_ON_CELLS * cellSpacing) * (RIVER_ON_CELLS * cellSpacing);
  const riverSnapD2 = (RIVER_SNAP_CELLS * cellSpacing) * (RIVER_SNAP_CELLS * cellSpacing);
  const riverStrength = new Float32Array(map.cellCount);
  if (riverGrid) {
    for (let i = 0; i < map.cellCount; i++) {
      if (map.elevation[i] < seaLevel) continue; // rivers run on land
      const nr = nearestRiverVertex(siteVec(map, i), riverGrid);
      if (nr && nr.chord2 <= onRiver2) riverStrength[i] = nr.width;
    }
  }

  // Habitability per cell ∈ [HABITABILITY_FLOOR, 1] — folded into every placement pool below so cities
  // favour wetter, ice-free land (the scoring is habitabilityWeight; here we just feed it each cell's
  // water proximity). Both penalties are floored, so a desert / ice city stays possible, just rarer.
  const desertAversion = CITIES.DESERT_AVERSION.value;
  const iceAversion = CITIES.ICE_AVERSION.value;
  const habitability = new Float32Array(map.cellCount);
  for (let i = 0; i < map.cellCount; i++) {
    // Water proximity: 1 on a drawn river or at the shore, fading to 0 by DRY_WATER_REACH hops inland.
    const nearWater = Math.max(riverStrength[i] > 0 ? 1 : 0, Math.max(0, 1 - coastDist[i] / DRY_WATER_REACH));
    habitability[i] = habitabilityWeight(map.moisture[i], map.ice[i], nearWater, desertAversion, iceAversion);
  }

  const isLargeWater = (nb: number): boolean => largeWater[nb] === 1;
  const isAnyWater = (nb: number): boolean => map.elevation[nb] < seaLevel;

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
    // The GLOBAL set is the big-city HEAD only — every settlement at/above cityMinPop (density-scaled). No arbitrary
    // cap: the count is whatever the 1400 rank-size yields (≈ urbanPop / (threshold · H)). The sub-threshold
    // tail is the patch-local town layer (regionTowns), grown per region on zoom. placeCities still
    // normalises sizes over the FULL hierarchy (its own settlements = round(urbanPop / TYPICAL_TOWN_POP) ≥ n),
    // so the big cities are sized identically; we just stop emitting once they drop below the threshold. The
    // capital always shows (≥1) even where the country is too small to field a city that big.
    const hierarchy = Math.max(1, Math.round(urbanPop / TYPICAL_TOWN_POP));
    const nCities = Math.min(cells.length, Math.max(1, Math.floor(urbanPop / (cityMinPop * harmonicNumber(hierarchy)))));
    // `placed` is size-ordered (largest first). A slot with no habitable site is dropped, so a country with
    // nowhere to live simply gets fewer cities.
    const placed = placeCities(map, cells, coastDist, seaDist, riverStrength, habitability, elevCap, nCities, urbanPop, rng);
    if (placed.length === 0) continue;
    const capitalIdx = pickWeightedRank(CAPITAL_RANK_WEIGHTS, placed.length, rng);
    const usedFunFacts = new Set<string>(); // dedupe fun facts within this country

    placed.forEach(({ cell, population }, idx) => {
      const isCapital = idx === capitalIdx;
      if (!isCapital && population < cityMinPop) return; // the sub-threshold tail is the patch-local town layer
      const tier = tierOf(population, isCapital);
      // Name is globally unique (the namer re-rolls on collision); stats are seeded on a SEPARATE stream
      // so adding them never shifts placement/population (which consume the per-country `rng` above).
      const name = namer.generate({ seed: `${mapSeed}|city|${country.index}|${idx}`, lang: country.language, unique: true });
      // Classify the cell's water by priority sea > large river > other water (lake/pond) > none — both for
      // flavour and to place the marker right ON that water. A river city's marker snaps to the drawn river
      // vertex; a shore city's to the fine waterline (sea or lake); the interior keeps its centre.
      const bordersSea = adjacency[cell].some(isLargeWater);
      const drawnRiver = nearestRiverVertex(siteVec(map, cell), riverGrid);
      const onRiver = drawnRiver !== null && drawnRiver.chord2 <= riverSnapD2;
      const waterKind: CityWaterKind = bordersSea
        ? "ocean"
        : onRiver
          ? "river"
          : coastDist[cell] === 0
            ? "lake"
            : "none";
      const anchor =
        waterKind === "ocean"
          ? coastAnchor(map, adjacency, cell, isLargeWater, fineLandAt)
          : waterKind === "river"
            ? Vec3.normalize(drawnRiver!.pt) // snap onto the drawn river — a city on its bank
            : waterKind === "lake"
              ? coastAnchor(map, adjacency, cell, isAnyWater, fineLandAt)
              : siteVec(map, cell);
      const profile = cityProfile({
        rawElevation: map.elevation[cell],
        reportElevation: reportElevation[cell],
        moisture: map.moisture[cell],
        rainfall: map.rainfall,
        ice: map.ice[cell],
        seaLevel,
        coastDist: coastDist[cell],
        seaDist: seaDist[cell],
        waterKind,
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
        anchor,
        cell,
        population,
        tier,
        isCapital,
        minLevel: isCapital ? 1 : minLevelForPopulation(population), // capital always on the globe (zoom 1)
        countryIndex: country.index,
        countryName: country.name,
        industries: profile.industries,
        elevationMeters: profile.elevationMeters,
        funFact: profile.funFact,
        waterKind,
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

// The four placement buckets. "rand" (anywhere on habitable land) is also the universal fallback: a city
// rolled into a feature bucket its country lacks (no river / no sea coast / no lakeshore) lands here instead.
type Bucket = "river" | "sea" | "lake" | "rand";

/** Weighted pick over `w` (a per-cell pool weight) restricted to cells whose elevation cap clears `needCap`
 *  (so a big city never lands on HIGH ground); -1 if the bucket has no eligible cell left. */
function sampleBucket(w: number[], cells: number[], elevCap: Int8Array, needCap: number, rng: RNG): number {
  let total = 0;
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && elevCap[cells[i]] >= needCap) total += w[i];
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0 || elevCap[cells[i]] < needCap) continue;
    r -= w[i];
    if (r <= 0) return i;
  }
  return -1;
}

/** A single city's bucket, by a weighted-random roll over the CITY.*_FRACTION dials; the leftover
 *  probability (1 − river − sea − lake) falls to "rand" (interior). One rng draw. */
function rollBucket(rng: RNG): Bucket {
  let r = rng();
  if ((r -= CITIES.RIVER_FRACTION.value) < 0) return "river";
  if ((r -= CITIES.SEA_FRACTION.value) < 0) return "sea";
  if ((r -= CITIES.LAKE_FRACTION.value) < 0) return "lake";
  return "rand";
}

// Harmonic number Hₘ = Σ_{k=1}^{m} 1/k, closed-form via the Euler–Maclaurin asymptotic (γ = Euler–
// Mascheroni constant); O(1) and exact enough above m=1, so the rank-size normaliser scales to a huge
// settlement hierarchy without a giant loop.
const harmonicNumber = (m: number): number =>
  m <= 1 ? m : Math.log(m) + 0.5772156649 + 1 / (2 * m) - 1 / (12 * m * m);

/**
 * Place one country's cities and size them by rank-size (city k gets urbanPop / (k · H), H the harmonic
 * number of the FULL settlement hierarchy — not just the emitted n — so sizes stay period-realistic). Each
 * city rolls a bucket by the CITY.*_FRACTION weights, then is placed by that bucket's rule: river ON a drawn
 * river (weighted by strength, so big rivers + mouths win), sea at a large-water shore, lake at a small-water
 * shore, rand anywhere habitable. If the country lacks the rolled feature the city drops to "rand" (so a
 * landlocked or river-less country still places its full count). Elevation-gated (a big city avoids HIGH
 * ground, VERY_HIGH never hosts one). Each placed city suppresses its neighbourhood so the rest spread out.
 * Size-ordered (largest first).
 */
function placeCities(
  map: GlobeMap,
  cells: number[],
  coastDist: Int32Array,
  seaDist: Int32Array,
  riverStrength: Float32Array,
  habitability: Float32Array, // per-cell ∈ [floor, 1]: down-weights dry far-interior + iced land (see assignCities)
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
  // Per-bucket pools over `cells` (weight 0 = ineligible): a drawn river runs through it (weight = strength,
  // peaking at mouths) / it touches LARGE water (sea) / it touches SMALL water only (lake) / anywhere. Every
  // pool is scaled by `habitability`, so dry far-interior + iced cells are picked less (the water buckets sit
  // near water, so their dryness penalty self-waives — only ice bites them). Mutated as cities are placed.
  const wRiver = cells.map((c) => (riverStrength[c] > 0 ? riverStrength[c] * habitability[c] : 0));
  const wSea = cells.map((c) => (seaDist[c] === 0 ? habitability[c] : 0));
  const wLake = cells.map((c) => (coastDist[c] === 0 && seaDist[c] !== 0 ? habitability[c] : 0));
  const wRand = cells.map((c) => habitability[c]);
  const pools: Record<Bucket, number[]> = { river: wRiver, sea: wSea, lake: wLake, rand: wRand };

  const placed: { cell: number; population: number }[] = [];
  for (let rank = 0; rank < n; rank++) {
    const population = Math.round(urbanPop / ((rank + 1) * harmonic));
    const needCap = population >= MEDIUM_POP ? 2 : 1; // big/medium need low ground; small may go up to HIGH
    const bucket = rollBucket(rng);
    // Try the rolled bucket; if the country has no such feature (or no cell low enough), fall to "anywhere".
    let chosen = sampleBucket(pools[bucket], cells, elevCap, needCap, rng);
    if (chosen < 0 && bucket !== "rand") chosen = sampleBucket(wRand, cells, elevCap, needCap, rng);
    if (chosen < 0) continue; // nowhere habitable left for this slot
    const cell = cells[chosen];
    placed.push({ cell, population });
    wRiver[chosen] = wSea[chosen] = wLake[chosen] = wRand[chosen] = 0; // without replacement (every pool)
    // Suppress the chosen cell's neighbourhood in every pool so the next city lands elsewhere, not stacked.
    const ax = sites[3 * cell];
    const ay = sites[3 * cell + 1];
    const az = sites[3 * cell + 2];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const dot = ax * sites[3 * c] + ay * sites[3 * c + 1] + az * sites[3 * c + 2];
      const keep = 1 - 0.85 * Math.exp(-(1 - dot) / SPREAD2);
      wRiver[i] *= keep;
      wSea[i] *= keep;
      wLake[i] *= keep;
      wRand[i] *= keep;
    }
  }
  return placed;
}
