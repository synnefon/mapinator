import { createNoise3D } from "simplex-noise";
import { Languages, type Language } from "../../common/language";
import type { GlobeMap } from "../../common/map";
import { makeRNG, randomChoice } from "../../common/random";
import { COUNTRY } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import type { NameGenerator } from "../NameGenerator";
import { vertexKey } from "./adjacency";
import { angularExtent, poleOfInaccessibility } from "./detect";
import { generateGovernment } from "./government";
import { climateHabitability, estimatePopulation } from "./population";

// The globe is rendered as a unit sphere; we size it to Earth EXACTLY so areas read in real units.
// Earth's published total surface area is the anchor, and the planet radius is derived from it (via
// 4πR²) so the two never drift — rather than the old 4π·6371² which only approximated it (≈0.0015% low).
export const EARTH_SURFACE_AREA_KM2 = 510_072_000; // Earth's total surface area
export const PLANET_RADIUS_KM = Math.sqrt(EARTH_SURFACE_AREA_KM2 / (4 * Math.PI)); // ≈ 6371.05 km

/** A country's land area in km², from its share of the planet's cells (whole sphere = Earth's surface). */
export const countryAreaKm2 = (cellCount: number, totalCells: number): number =>
  (cellCount / totalCells) * EARTH_SURFACE_AREA_KM2;

export type Country = {
  index: number; // compact index, matching values in CountryData.countryOf
  language: Language;
  name: string; // bare proper name, in the country's own language
  cellCount: number;
  areaKm2: number;
  government: string; // composed government type, e.g. "federal republic"
  population: number;
  anchorCell: number; // label position — the country's interior-most cell
  extent: number; // angular radius (rad) for label sizing
};

/** Assigns any unit-sphere point to a country (compact index, or -1 only when there's no land) by the
 *  nearest BASE land cell — so a finer LOD patch labels its cells the same country the globe grew them
 *  into (the region-grow has no closed form). Land vs. water isn't judged here; callers gate on a
 *  patch's own elevation so the highlight respects that patch's coastline. */
export type CountryClassifier = (x: number, y: number, z: number) => number;

export type CountryData = {
  countryOf: Int32Array; // per cell: compact country index, or -1 for ocean / uninhabited water
  countries: Country[];
  classify: CountryClassifier; // classify arbitrary sphere points (used to map LOD patch cells)
};

// Binary min-heap of (key, value) pairs over typed arrays — the priority queue for the country
// region-grow. The value is a cell id; pop() exposes poppedKey so Dijkstra can skip stale entries (a
// cell re-pushed at a lower cost). Grows on demand, since a cell may be pushed more than once.
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  poppedKey = 0;
  constructor(capacity: number) {
    const cap = Math.max(16, capacity);
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(val: number, key: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    this.poppedKey = this.keys[0];
    const last = --this.size;
    this.keys[0] = this.keys[last];
    this.vals[0] = this.vals[last];
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.size && this.keys[l] < this.keys[m]) m = l;
      if (r < this.size && this.keys[r] < this.keys[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private swap(i: number, j: number): void {
    const k = this.keys[i];
    this.keys[i] = this.keys[j];
    this.keys[j] = k;
    const v = this.vals[i];
    this.vals[i] = this.vals[j];
    this.vals[j] = v;
  }
}

/**
 * Partition the land into countries. Seeds are placed on land with a tunable spread (evenly spaced →
 * clumped), then every cell is grown out from the seeds along the CHEAPEST path: crossing water costs
 * WATER_COST× a land step, so a country fills its own landmass before spilling across the sea, and a
 * noise term wiggles the advancing front for organic borders. Water conducts the wave (islands still
 * get claimed across narrow straits) but never keeps territory. The first country takes the map's
 * language — guaranteeing ≥1 shares it — the rest draw from the pool and may repeat. Deterministic.
 */
export function assignCountries(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  mapSeed: string,
  mapLanguage: Language,
  languagePool: Language[],
  namer: NameGenerator
): CountryData {
  const { cellCount, sites, elevation, moisture, ice, rainfall } = map;
  const countryOf = new Int32Array(cellCount).fill(-1);

  const land: number[] = [];
  for (let i = 0; i < cellCount; i++) if (elevation[i] >= seaLevel) land.push(i);
  if (land.length === 0) return { countryOf, countries: [], classify: () => -1 };

  // One seed per country — the raw count off the dial, clamped to the land available.
  const n = Math.min(land.length, Math.max(2, Math.round(COUNTRY.NUM_COUNTRIES.value)));

  // --- seeds over land. Two knobs shape the constellation: CLUSTER_COUNT well-separated anchors go
  // down first (farthest-point), then COUNTRY_CLUSTERING decides how the rest fall in — toward those
  // anchors (clumped, 1) or evenly across the map (0). So clustering = clumpiness, cluster count =
  // how many clumps. ---
  const seedRng = makeRNG(`${mapSeed}|country-seeds`);
  const clustering = COUNTRY.COUNTRY_CLUSTERING.value; // 1 = clumped toward the anchors, 0 = even
  const clusterCount = Math.min(n, Math.max(1, Math.round(COUNTRY.CLUSTER_COUNT.value)));
  const firstIdx = Math.floor(seedRng() * land.length);
  const seeds: number[] = [land[firstIdx]];
  const placed = new Uint8Array(land.length);
  placed[firstIdx] = 1;
  // nearestDot[i] = closeness of land[i] to its nearest existing seed (dot product; higher = closer).
  const nearestDot = new Float64Array(land.length).fill(-Infinity);
  const note = (cell: number): void => {
    const ax = sites[3 * cell];
    const ay = sites[3 * cell + 1];
    const az = sites[3 * cell + 2];
    for (let i = 0; i < land.length; i++) {
      const c = land[i];
      const d = ax * sites[3 * c] + ay * sites[3 * c + 1] + az * sites[3 * c + 2];
      if (d > nearestDot[i]) nearestDot[i] = d;
    }
  };
  // Make the unplaced land cell at a given CLOSENESS percentile a seed (0 = farthest from every seed →
  // spreads out, 1 = closest → clumps), then record it so later picks see it.
  const placeSeed = (closenessPct: number): void => {
    const cand: number[] = [];
    for (let i = 0; i < land.length; i++) if (!placed[i]) cand.push(i);
    cand.sort((p, q) => nearestDot[p] - nearestDot[q]);
    const idx = cand[Math.round(closenessPct * (cand.length - 1))];
    placed[idx] = 1;
    seeds.push(land[idx]);
    note(land[idx]);
  };
  note(seeds[0]);
  while (seeds.length < clusterCount) placeSeed(0); // cluster anchors: as far apart as possible
  while (seeds.length < n) placeSeed(clustering); // the rest fall in per the clustering knob

  // --- grow each country out from its seed (multi-source Dijkstra over the cell graph). The step cost
  // is the distance between DOMAIN-WARPED cell positions: nudging every cell by a 3D-noise field
  // stretches the metric, so the borders (equidistant fronts) wander organically — WARP_AMP sets how
  // far they stray, WARP_FREQ the scale. Crossing WATER costs WATER_COST× extra, so the wave fills a
  // landmass before spilling over the sea; water carries the wave (islands still get claimed across
  // narrow straits) but never keeps territory — only land cells are written into countryOf below. ---
  const warp = createNoise3D(makeRNG(`${mapSeed}|country-warp`));
  const f = COUNTRY.WARP_FREQ.value;
  const a = COUNTRY.WARP_AMP.value;
  const waterCost = COUNTRY.WATER_COST.value;
  // Each cell's warped position (decorrelated per axis), precomputed once. Stepping between these
  // rather than the raw sites is what bends the borders.
  const wpx = new Float64Array(cellCount);
  const wpy = new Float64Array(cellCount);
  const wpz = new Float64Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    const x = sites[3 * c];
    const y = sites[3 * c + 1];
    const z = sites[3 * c + 2];
    wpx[c] = x + a * warp(x * f, y * f, z * f);
    wpy[c] = y + a * warp(x * f + 31.4, y * f + 27.1, z * f + 11.7);
    wpz[c] = z + a * warp(x * f - 19.3, y * f - 7.7, z * f + 44.2);
  }
  const owner = new Int32Array(cellCount).fill(-1);
  const dist = new Float64Array(cellCount).fill(Infinity);
  const heap = new MinHeap(cellCount);
  for (let k = 0; k < seeds.length; k++) {
    dist[seeds[k]] = 0;
    owner[seeds[k]] = k;
    heap.push(seeds[k], 0);
  }
  while (heap.size > 0) {
    const c = heap.pop();
    if (heap.poppedKey > dist[c]) continue; // stale entry — c already settled cheaper
    for (const nb of adjacency[c]) {
      const dx = wpx[c] - wpx[nb];
      const dy = wpy[c] - wpy[nb];
      const dz = wpz[c] - wpz[nb];
      const step = Math.sqrt(dx * dx + dy * dy + dz * dz) * (elevation[nb] < seaLevel ? waterCost : 1);
      const nd = dist[c] + step;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        owner[nb] = owner[c];
        heap.push(nb, nd);
      }
    }
  }
  for (const c of land) countryOf[c] = owner[c]; // seed index for now (compacted below); water stays -1

  // --- build the country list (drop seeds that won no cells), assign languages + names ---
  const cellsBySeed: number[][] = Array.from({ length: seeds.length }, () => []);
  for (const c of land) cellsBySeed[countryOf[c]].push(c);

  const pool = languagePool.length ? languagePool : [...Languages];
  const langRng = makeRNG(`${mapSeed}|country-langs`);
  const compact = new Int32Array(seeds.length).fill(-1);
  const countries: Country[] = [];
  let assignedMapLang = false;

  for (let k = 0; k < seeds.length; k++) {
    const cells = cellsBySeed[k];
    if (cells.length === 0) continue;
    let language: Language;
    if (!assignedMapLang) {
      language = mapLanguage; // guarantee ≥1 country shares the map's language
      assignedMapLang = true;
    } else {
      language = randomChoice(pool, langRng);
    }
    const anchorCell = poleOfInaccessibility(cells, adjacency);

    // Government + population, deterministic per country. Latitude is the anchor's (north = +y).
    const polityRng = makeRNG(`${mapSeed}|polity|${k}`);
    const government = generateGovernment(polityRng);
    const areaKm2 = countryAreaKm2(cells.length, cellCount);
    const latitudeDeg =
      (Math.asin(Math.max(-1, Math.min(1, sites[3 * anchorCell + 1]))) * 180) / Math.PI;
    // Mean biome habitability over the country's land: greener cells lift density, desert / ice /
    // mountain cells drop it (same biome classes the renderer draws — see terrainClassOf).
    let climateSum = 0;
    for (const cell of cells) {
      const tc = terrainClassOf(elevation[cell], moisture[cell], rainfall);
      if (tc) climateSum += climateHabitability(tc.band, tc.family, ice[cell]);
    }
    const climate = climateSum / cells.length; // cells is non-empty (guarded above)
    const population = estimatePopulation({
      areaKm2,
      latitudeDeg,
      government,
      climate,
      jitter: polityRng(),
    });

    const name = namer.generate({ seed: `${mapSeed}|country|${k}`, lang: language, government: government });

    compact[k] = countries.length;
    countries.push({
      index: countries.length,
      language,
      name,
      cellCount: cells.length,
      areaKm2,
      government: government.type,
      population,
      anchorCell,
      extent: angularExtent(anchorCell, cells, sites),
    });
  }

  for (const c of land) countryOf[c] = compact[countryOf[c]]; // seed index → compact index

  // A reusable point→country test: the region-grow has no closed form, so classify a point by the
  // country of the nearest BASE land cell (compact index). Used to map an LOD patch's cells onto the
  // globe's countries; O(land) per call, so callers cache it per hovered country.
  const classify: CountryClassifier = (x, y, z) => {
    let best = -1;
    let bestDot = -Infinity;
    for (const c of land) {
      const d = x * sites[3 * c] + y * sites[3 * c + 1] + z * sites[3 * c + 2];
      if (d > bestDot) {
        bestDot = d;
        best = c;
      }
    }
    return best >= 0 ? countryOf[best] : -1;
  };

  return { countryOf, countries, classify };
}

/**
 * Per-cell country index for an LOD detail patch (compact index, or -1 for water): classify each cell
 * by the base globe's assignment, but only where the PATCH says land — its finer coastline is what lets
 * the hover highlight respect the water boundary up close. Computed on demand (one country hovered at a
 * time), so callers cache a few of these. Borders are NOT recomputed here — they stay base-resolution.
 */
export function patchCountryOf(
  patch: GlobeMap,
  seaLevel: number,
  classify: CountryClassifier
): Int32Array {
  const { cellCount, sites, elevation } = patch;
  const out = new Int32Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    out[i] =
      elevation[i] >= seaLevel
        ? classify(sites[3 * i], sites[3 * i + 1], sites[3 * i + 2])
        : -1;
  }
  return out;
}

/**
 * The largest country bordering the water body the anchor sits in — found by a bounded BFS out over
 * the water, collecting the countries of any shore land cells and keeping the biggest. Lakes (small)
 * get fully covered; an open-ocean anchor only sees its LOCAL coast, so different seas take different
 * tongues. Returns a compact country index, or -1 if no coast is within range (deep open ocean).
 */
export function largestBorderingCountry(
  anchorCell: number,
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  data: CountryData,
  maxHops = COUNTRY.BORDER_HOPS.value
): number {
  const { elevation } = map;
  const { countryOf, countries } = data;
  const isWater = (i: number): boolean => elevation[i] < seaLevel;
  const seen = new Set<number>([anchorCell]);
  let frontier = [anchorCell];
  let best = -1;
  let bestSize = -1;
  for (let hop = 0; hop <= maxHops && frontier.length; hop++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const nb of adjacency[c]) {
        if (isWater(nb)) {
          if (!seen.has(nb)) {
            seen.add(nb);
            next.push(nb);
          }
        } else {
          const ci = countryOf[nb]; // a shore land cell
          if (ci >= 0 && countries[ci].cellCount > bestSize) {
            bestSize = countries[ci].cellCount;
            best = ci;
          }
        }
      }
    }
    frontier = next;
  }
  return best;
}

/**
 * Country border segments: the shared cell-polygon edges between two LAND cells of different
 * countries (coast edges touch ocean — country-less — so they're excluded). Returned as flat
 * [x0,y0,z0, x1,y1,z1, …] unit-sphere pairs for the overlay to project + stroke.
 */
export function countryBorderSegments(map: GlobeMap, countryOf: Int32Array): Float32Array {
  const { cellCount, ringOffsets, ringVerts } = map;
  const edges = new Map<string, { p: number[]; cells: number[] }>();

  for (let i = 0; i < cellCount; i++) {
    if (countryOf[i] < 0) continue; // ocean cell — no country borders touch it
    const start = ringOffsets[i];
    const k = ringOffsets[i + 1] - start;
    for (let j = 0; j < k; j++) {
      const a = start + j;
      const b = start + ((j + 1) % k); // closed ring, wraps to the first vertex
      const ax = ringVerts[3 * a];
      const ay = ringVerts[3 * a + 1];
      const az = ringVerts[3 * a + 2];
      const bx = ringVerts[3 * b];
      const by = ringVerts[3 * b + 1];
      const bz = ringVerts[3 * b + 2];
      const ka = vertexKey(ax, ay, az);
      const kb = vertexKey(bx, by, bz);
      if (ka === kb) continue; // degenerate (a closed ring repeating its first vertex)
      const ekey = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
      const e = edges.get(ekey);
      if (e) e.cells.push(i);
      else edges.set(ekey, { p: [ax, ay, az, bx, by, bz], cells: [i] });
    }
  }

  const out: number[] = [];
  for (const e of edges.values()) {
    if (e.cells.length !== 2) continue; // coastline (1 land cell) or non-manifold — not a border
    if (countryOf[e.cells[0]] !== countryOf[e.cells[1]]) out.push(...e.p);
  }
  return new Float32Array(out);
}

/**
 * Greedy four-colouring of the country adjacency graph: neighbouring countries get different colour
 * classes (0–3) so a choropleth fill never abuts itself. Countries are coloured highest-degree first
 * (Welsh–Powell), each taking the lowest class no neighbour uses; the four-colour theorem says a planar
 * map needs ≤4, and the rare greedy overflow falls back to class 0. Returns a class per country index.
 */
export function fourColorCountries(
  countryOf: Int32Array,
  adjacency: number[][],
  countryCount: number
): Int32Array {
  const neighbors: Set<number>[] = Array.from({ length: countryCount }, () => new Set<number>());
  for (let i = 0; i < countryOf.length; i++) {
    const ci = countryOf[i];
    if (ci < 0) continue;
    for (const nb of adjacency[i]) {
      const cj = countryOf[nb];
      if (cj >= 0 && cj !== ci) {
        neighbors[ci].add(cj);
        neighbors[cj].add(ci);
      }
    }
  }
  const order = Array.from({ length: countryCount }, (_v, k) => k).sort(
    (a, b) => neighbors[b].size - neighbors[a].size
  );
  const color = new Int32Array(countryCount).fill(-1);
  for (const c of order) {
    const used = new Set<number>();
    for (const nb of neighbors[c]) if (color[nb] >= 0) used.add(color[nb]);
    let chosen = 0;
    while (chosen < 4 && used.has(chosen)) chosen++;
    color[c] = chosen < 4 ? chosen : 0; // ≤4 suffices for a planar map; fall back if greedy overflows
  }
  return color;
}
