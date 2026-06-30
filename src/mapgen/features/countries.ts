import { createNoise3D } from "simplex-noise";
import type { Vec3 } from "../../common/3DMath";
import { Languages, type Language } from "../../common/language";
import type { GlobeMap, PatchCountryData } from "../../common/map";
import { makeRNG, randomChoice } from "../../common/random";
import { COUNTRIES } from "../../common/settings";
import { refineSphereCurve } from "../../common/sphereCurve";
import type { NameGenerator } from "../NameGenerator";
import { buildAdjacency, coastDistance, vertexKey } from "./adjacency";
import { buildKdTree, nearestCell } from "./kdTree";
import { angularExtent, poleOfInaccessibilityWithRadius } from "./detect";
import { generateGovernment, type GovType } from "./government";
import { estimatePopulation } from "./population";
import { cellSlope, cellSuitability, coastBonus } from "./suitability";

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
  govType: GovType; // the base form + its semantic tags — drives city industry + fun facts
  population: number;
  anchorCell: number; // label position — the country's interior-most cell
  extent: number; // angular radius (rad) for label sizing
  insRadius: number; // inscribed radius (rad): how far a label may slide from the anchor + stay interior
};

export type CountryData = {
  countryOf: Int32Array; // per cell: compact country index, or -1 for ocean / uninhabited water
  countries: Country[];
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
  reportElevation: Float32Array, // the inland-risen display elevation (see inlandRisenElevation) — passed
  // explicitly, not read off the map, so this function's dependency on the risen field is named, not implicit
  seaLevel: number,
  adjacency: number[][],
  mapSeed: string,
  mapLanguage: Language,
  languagePool: Language[],
  namer: NameGenerator
): CountryData {
  const { cellCount, sites, elevation, moisture, ice } = map;
  const countryOf = new Int32Array(cellCount).fill(-1);

  const land: number[] = [];
  for (let i = 0; i < cellCount; i++) if (elevation[i] >= seaLevel) land.push(i);
  if (land.length === 0) return { countryOf, countries: [] };

  // One seed per country — the raw count off the dial, clamped to the land available.
  const n = Math.min(land.length, Math.max(2, Math.round(COUNTRIES.NUM_COUNTRIES.value)));

  // --- seeds over land. Two knobs shape the constellation: CLUSTER_COUNT well-separated anchors go
  // down first (farthest-point), then COUNTRY_CLUSTERING decides how the rest fall in — toward those
  // anchors (clumped, 1) or evenly across the map (0). So clustering = clumpiness, cluster count =
  // how many clumps. ---
  const seedRng = makeRNG(`${mapSeed}|country-seeds`);
  const clustering = COUNTRIES.COUNTRY_CLUSTERING.value; // 1 = clumped toward the anchors, 0 = even
  const clusterCount = Math.min(n, Math.max(1, Math.round(COUNTRIES.CLUSTER_COUNT.value)));
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
  const f = COUNTRIES.WARP_FREQ.value;
  const a = COUNTRIES.WARP_AMP.value;
  const waterCost = COUNTRIES.WATER_COST.value;
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

  // Per-cell inputs to the suitability model, computed once over the whole globe: local relief
  // (ruggedness) and hops to the nearest water (the coastal density bonus). Each land cell's area is
  // the planet's surface split evenly across cells — the same equal-area basis as countryAreaKm2.
  const slope = cellSlope(elevation, adjacency);
  const coastDist = coastDistance(map, seaLevel, adjacency);
  const areaPerCellKm2 = EARTH_SURFACE_AREA_KM2 / cellCount;

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
    // The interior-most cell anchors the label; its hop distance to the border is the inscribed radius,
    // converted to radians via the mean cell spacing (√(4π/N)) — the label's slide budget (see CountryInfo).
    const { cell: anchorCell, hops: insHops } = poleOfInaccessibilityWithRadius(cells, adjacency);
    const insRadius = insHops * Math.sqrt((4 * Math.PI) / cellCount);

    // Government + population, deterministic per country.
    const polityRng = makeRNG(`${mapSeed}|polity|${k}`);
    const government = generateGovernment(polityRng);
    const areaKm2 = countryAreaKm2(cells.length, cellCount);
    // Carrying capacity = Σ over the country's OWN land cells of (cell area × per-cell suitability ×
    // coastal bonus) — a SUM, not an average, so a thin Nile-like ribbon of rich land through an empty
    // desert counts its few habitable cells at full weight instead of being diluted to the country
    // mean. Latitude is per cell (north = +y), feeding the lapse-rate temperature in the suitability.
    let effectiveAreaKm2 = 0;
    for (const cell of cells) {
      const latitudeDeg =
        (Math.asin(Math.max(-1, Math.min(1, sites[3 * cell + 1]))) * 180) / Math.PI;
      const suitability = cellSuitability(
        {
          latDeg: latitudeDeg,
          reportElevation: reportElevation[cell],
          moisture: moisture[cell],
          ice: ice[cell],
          slope: slope[cell],
        },
        seaLevel
      );
      effectiveAreaKm2 += areaPerCellKm2 * suitability * coastBonus(coastDist[cell]);
    }
    const population = estimatePopulation({ effectiveAreaKm2, government, jitter: polityRng() });

    // Globally unique across the whole map (the namer re-rolls on collision; reset per generation).
    const name = namer.generate({ seed: `${mapSeed}|country|${k}`, lang: language, government, unique: true });

    compact[k] = countries.length;
    countries.push({
      index: countries.length,
      language,
      name,
      cellCount: cells.length,
      areaKm2,
      government: government.type,
      govType: government.govType,
      population,
      anchorCell,
      extent: angularExtent(anchorCell, cells, sites),
      insRadius,
    });
  }

  for (const c of land) countryOf[c] = compact[countryOf[c]]; // seed index → compact index

  return { countryOf, countries };
}

/**
 * Re-grow the country partition on an LOD detail patch's FINE mesh, so the choropleth + hover highlight
 * follow the patch's own coastline instead of the coarse base cells. `fineElevation` is the patch's
 * per-cell elevation (read back from the GPU — the field actually drawn); it defines land/water here.
 *
 * A fine LAND cell whose nearest BASE cell is itself land is SEEDED with that base cell's country (it's
 * confidently interior to a coarse country). Coast-overhang land — fine land beyond the coarse coast,
 * whose nearest base cell is water — is left unseeded, then filled by a multi-source Dijkstra that grows
 * over fine LAND ONLY. Because water is a hard barrier (never relaxed across), a country can't hop a
 * strait into another landmass — the fix for narrow land with water on multiple sides. Any land the grow
 * can't reach falls back to its nearest base-land country, so EVERY land cell is covered. Returns the
 * fine per-cell country: -1 for water, else the owning country.
 *
 * Runs on the worker, off the main thread (see WorkerPool.computeCountries) — `base` is the base
 * assignment's seed arrays, not a full GlobeMap.
 */
export function patchCountryData(
  patch: GlobeMap,
  fineElevation: Float32Array,
  seaLevel: number,
  base: Pick<GlobeMap, "sites" | "cellCount" | "elevation">,
  baseCountryOf: Int32Array
): PatchCountryData {
  const n = patch.cellCount;
  const { sites } = patch;
  const countryOf = new Int32Array(n).fill(-1);
  const isLand = (i: number): boolean => fineElevation[i] >= seaLevel;

  // Seed ONLY confidently-interior fine land — a cell whose every neighbour is land too — from the base
  // assignment (nearest base cell). A COASTAL fine cell is deliberately left UNSEEDED: its Euclidean-nearest
  // base land can belong to a different country across a strait, and seeding it directly would strait-hop
  // (the grow below can't override a seed — it only fills unseeded cells). The land-constrained grow reaches
  // coastal cells over LAND from the interior instead, so each takes the country it's actually contiguous with.
  const adjacency = buildAdjacency(patch);
  const tree = buildKdTree(base.sites, base.cellCount);
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (!isLand(i)) continue;
    let interior = true;
    for (const nb of adjacency[i]) if (!isLand(nb)) { interior = false; break; }
    if (!interior) continue; // coastal — leave it for the land-constrained grow (no strait-hop)
    const bc = nearestCell(tree, base.sites, sites[3 * i], sites[3 * i + 1], sites[3 * i + 2]);
    if (bc >= 0 && base.elevation[bc] >= seaLevel) {
      countryOf[i] = baseCountryOf[bc];
      dist[i] = 0;
      heap.push(i, 0);
    }
  }

  // Grow out from the interior seeds. A LAND edge costs its length; a WATER edge costs WATER_COST× that, so
  // connected land is reached cheaply OVER LAND (a country can't hop a strait to a coast that's reachable
  // overland — that route is far cheaper), while a coast fragment or island the fine mesh cut off behind a
  // thin channel is still claimed by the nearest coast ACROSS the water (a few costly steps) instead of a
  // straight-line hop to a far country. Water only CARRIES the country to reach stranded land; it's reset to
  // -1 afterwards (water has no country of its own).
  const WATER_COST = COUNTRIES.WATER_COST.value;
  while (heap.size > 0) {
    const c = heap.pop();
    if (heap.poppedKey > dist[c]) continue; // stale entry (c re-pushed cheaper since)
    const cx = sites[3 * c], cy = sites[3 * c + 1], cz = sites[3 * c + 2];
    for (const nb of adjacency[c]) {
      const dx = cx - sites[3 * nb], dy = cy - sites[3 * nb + 1], dz = cz - sites[3 * nb + 2];
      const nd = dist[c] + Math.sqrt(dx * dx + dy * dy + dz * dz) * (isLand(nb) ? 1 : WATER_COST);
      if (nd < dist[nb]) {
        dist[nb] = nd;
        countryOf[nb] = countryOf[c];
        heap.push(nb, nd);
      }
    }
  }
  for (let i = 0; i < n; i++) if (!isLand(i)) countryOf[i] = -1; // water carried the grow; it has no country

  // Last resort: a land cell the grow STILL couldn't reach (only happens when the patch has NO interior
  // seeds at all — e.g. nothing but thin coast) takes the nearest BASE-LAND country, so every land cell is
  // covered. Normally the water-cost grow above reaches everything, so this builds nothing.
  let unreached = 0;
  for (let i = 0; i < n; i++) if (isLand(i) && countryOf[i] < 0) unreached++;
  if (unreached > 0) {
    const landIdx: number[] = [];
    for (let b = 0; b < base.cellCount; b++) if (base.elevation[b] >= seaLevel) landIdx.push(b);
    if (landIdx.length > 0) {
      const landSites = new Float32Array(landIdx.length * 3);
      for (let j = 0; j < landIdx.length; j++) {
        const b = landIdx[j];
        landSites[3 * j] = base.sites[3 * b];
        landSites[3 * j + 1] = base.sites[3 * b + 1];
        landSites[3 * j + 2] = base.sites[3 * b + 2];
      }
      const landTree = buildKdTree(landSites, landIdx.length);
      for (let i = 0; i < n; i++) {
        if (!isLand(i) || countryOf[i] >= 0) continue;
        const j = nearestCell(landTree, landSites, sites[3 * i], sites[3 * i + 1], sites[3 * i + 2]);
        if (j >= 0) countryOf[i] = baseCountryOf[landIdx[j]];
      }
    }
  }

  return { countryOf };
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
  maxHops = COUNTRIES.BORDER_HOPS.value
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
 * Country borders as REFINED sphere polylines: the coarse inter-country edges (same set as
 * countryBorderSegments) chained into arcs between junctions, then fractally subdivided via the shared
 * refineSphereCurve primitive — so a border gains organic, self-similar detail that resolves on ZOOM
 * with NO per-patch recompute (the vector-overlay pattern, like rivers). Computed ONCE per map.
 * Returns flat [x0,y0,z0, x1,y1,z1, …] unit-sphere segment pairs for the overlay to project + stroke.
 */
export function refineCountryBorders(
  map: GlobeMap,
  countryOf: Int32Array,
  opts: { levels: number; amplitude: number }
): Float32Array {
  const { cellCount, ringOffsets, ringVerts } = map;

  // 1. Deduped inter-country edges (a cell-polygon edge shared by two LAND cells of different countries),
  //    keeping each endpoint's vertex key + position so they can be chained.
  type Edge = { ka: string; kb: string; a: Vec3; b: Vec3; cells: number[] };
  const edges = new Map<string, Edge>();
  for (let i = 0; i < cellCount; i++) {
    if (countryOf[i] < 0) continue;
    const start = ringOffsets[i];
    const k = ringOffsets[i + 1] - start;
    for (let j = 0; j < k; j++) {
      const a = start + j;
      const b = start + ((j + 1) % k);
      const ax = ringVerts[3 * a], ay = ringVerts[3 * a + 1], az = ringVerts[3 * a + 2];
      const bx = ringVerts[3 * b], by = ringVerts[3 * b + 1], bz = ringVerts[3 * b + 2];
      const ka = vertexKey(ax, ay, az);
      const kb = vertexKey(bx, by, bz);
      if (ka === kb) continue;
      const ekey = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
      const e = edges.get(ekey);
      if (e) e.cells.push(i);
      else edges.set(ekey, { ka, kb, a: { x: ax, y: ay, z: az }, b: { x: bx, y: by, z: bz }, cells: [i] });
    }
  }

  // 2. Vertex graph over the true borders (shared by exactly 2 land cells of differing countries).
  const pos = new Map<string, Vec3>();
  const adj = new Map<string, string[]>();
  const link = (key: string, nb: string): void => {
    const a = adj.get(key);
    if (a) a.push(nb);
    else adj.set(key, [nb]);
  };
  for (const e of edges.values()) {
    if (e.cells.length !== 2 || countryOf[e.cells[0]] === countryOf[e.cells[1]]) continue;
    pos.set(e.ka, e.a);
    pos.set(e.kb, e.b);
    link(e.ka, e.kb);
    link(e.kb, e.ka);
  }

  // 3. Walk into polylines: arcs between junctions/ends (degree ≠ 2) first, then any leftover pure loops.
  //    Each edge is walked once; the fractal hash is deterministic per point, so independent arcs stay
  //    seamless where they meet.
  const used = new Set<string>();
  const ekeyOf = (k1: string, k2: string): string => (k1 < k2 ? `${k1}~${k2}` : `${k2}~${k1}`);
  const lines: Vec3[][] = [];
  const walk = (startK: string): void => {
    for (const first of adj.get(startK)!) {
      if (used.has(ekeyOf(startK, first))) continue;
      const line: Vec3[] = [pos.get(startK)!];
      let prev = startK;
      let cur = first;
      used.add(ekeyOf(prev, cur));
      line.push(pos.get(cur)!);
      while (adj.get(cur)!.length === 2 && cur !== startK) {
        const [n0, n1] = adj.get(cur)!;
        const next = n0 === prev ? n1 : n0;
        if (used.has(ekeyOf(cur, next))) break;
        used.add(ekeyOf(cur, next));
        line.push(pos.get(next)!);
        prev = cur;
        cur = next;
      }
      lines.push(line);
    }
  };
  for (const [k, nbs] of adj) if (nbs.length !== 2) walk(k);
  for (const [k, nbs] of adj) if (nbs.length === 2 && !used.has(ekeyOf(k, nbs[0]))) walk(k);

  // 4. Refine each arc + emit as flat segment pairs (values unused — borders carry no per-vertex scalar).
  const out: number[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const { points } = refineSphereCurve(line, line.map(() => 0), opts);
    for (let i = 0; i + 1 < points.length; i++) {
      const p = points[i];
      const q = points[i + 1];
      out.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
  }
  return new Float32Array(out);
}

// Choropleth colour classes. A planar country map is 4-colourable in theory, but greedy Welsh–Powell
// isn't guaranteed to FIND a 4-colouring and overflowed in practice (neighbours shared a hue); six gives
// it enough slack. Must not exceed the HUES palette length (renderer/countryTexture.ts).
const COLOR_CLASSES = 6;

/**
 * Greedy colouring of the country adjacency graph: neighbouring countries get different colour classes
 * (0 … COLOR_CLASSES−1) so a choropleth fill never abuts itself. Countries are coloured highest-degree
 * first (Welsh–Powell), each taking the lowest class no neighbour uses; a rare overflow falls back to
 * class 0. Returns a class per country index.
 */
export function colorCountries(
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
    while (chosen < COLOR_CLASSES && used.has(chosen)) chosen++;
    color[c] = chosen < COLOR_CLASSES ? chosen : 0; // fall back if greedy overflows the palette
  }
  return color;
}
