import { Vec3 } from "../../common/3DMath";
import { makeRNG, type RNG } from "../../common/random";
import { cellSuitability, coastBonus } from "./suitability";

// ===================== The one settlement engine =====================
// EVERY settlement on the map — the capital, the big cities on the globe, and the small towns revealed on
// zoom — comes out of ONE continuous law per country, with no scale ladder, no per-view scan, and no global
// top-N cut. A country's settlement SIZES are a rank-size (Zipf) curve driven by its population P (itself
// global density × habitable area, so both flow in): `size(rank) = share · P / rank^falloff`, emitted down to
// a floor (rankSizePopulations). Raising P (or global density) grows EVERY existing size AND lifts more ranks
// above the floor — new small settlements appear at the bottom — continuously, no thresholds.
//
// Those ranks are PLACED on the country's most habitable, well-spaced land (placeSettlements): cells are
// ranked by the population-density field (all the habitability logic — suitability, coast, river, anti-desert,
// anti-ice), the biggest city takes the best spot, and each new settlement must clear a spacing that shrinks
// with its size (big cities spread, towns pack in). Each placed point is then ROUTED (`finishSettlements`):
// snapped onto the drawn river, the sea shore, or the lakeshore it sits by (or left inland). Pure +
// deterministic — the caller injects a `SettlementWorld` of field + water lookups, so it's unit-testable with
// fakes; cityStats.assembleCities runs it per country and the whole set is cached with the map.

// The water a settlement sits on, by priority sea > large river > other water (lake/pond) > none. Drives the
// riverside/coastal flavour split + (for big cities) a debug tint on the marker.
export type SettlementWaterKind = "ocean" | "river" | "lake" | "none";

// Marker size class, by population — drives the dot's CSS class + flavour gating (NOT the size noun, which
// keys on population via settlementClass, nor the zoom-reveal level, via minLevelForPopulation).
export type SettlementTier = "big" | "medium" | "small";

/** A settlement marker: a point inside a country, sized + zoom-gated, with a generated name and an estimated
 *  population. `anchor` is a unit-sphere point, snapped to its water. Carries the displayable extras the click
 *  card shows. Capitals, big cities, and small towns are all IDENTICAL Settlement objects from the one law —
 *  see cityStats.assembleCities. */
export type Settlement = {
  name: string;
  anchor: Vec3;
  cell: number; // the nearest base-map cell (for coast/terrain lookups in tests/audits); -1 for tail towns
  population: number;
  tier: SettlementTier;
  isCapital: boolean;
  minLevel: number; // lowest LOD zoom level the marker shows at — by population (minLevelForPopulation); capitals forced to 1
  countryIndex: number;
  countryName: string; // owning country's name — for the "(capital of …)" card line
  industries: string[]; // 1–3 leading industries (biome + government tags + size + water proximity)
  elevationMeters: number; // realistic elevation, Mount-Everest-anchored
  funFact: string; // short, deterministic flavour line
  waterKind: SettlementWaterKind; // the water the marker sits ON, by priority — the river/lake/coastal flavour split
};

// ===================== Habitability — settlements avoid deserts + ice =====================
// A per-cell weight folded into the density, so settlements prefer wetter, ice-free land. Both penalties are
// MULTIPLIERS floored above 0, so a desert / ice settlement stays possible, just rarer — never hard-excluded.
const DRY_MOISTURE = 0.38; // moisture below this reads as "dry"; the dryness penalty ramps in below it
const DRY_WATER_REACH = 3; // hops to water within which the DRYNESS penalty is fully waived — desert coasts settle freely
export const HABITABILITY_FLOOR = 0.04; // a cell never drops below this weight: the bone-dry, fully-iced far interior is rare, not banned

/** A cell's habitability ∈ [HABITABILITY_FLOOR, 1]. Two FLOORED multipliers, so neither penalty is ever
 *  absolute: a DRYNESS penalty (moisture below DRY_MOISTURE) that `nearWater` ∈ [0,1] waives toward water —
 *  a desert coast / riverbank / oasis settles freely — and an ICE penalty that bites everywhere. Pure +
 *  exported so the weighting is unit-testable. */
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

// ===================== Drawn-river lookup: a spatial hash of the rendered network's vertices =====================
// Settlements are placed ON + snap to the rivers the renderer actually draws, so a river settlement visibly
// sits on a visible river. A vertex counts once its flow strength ≥ the floor; placement then weights by the
// coast bonus (a river is water access), and a river settlement snaps to the nearest vertex. All distances
// are squared chords; thresholds are passed in base cell-spacings by the caller.
export type RiverGrid = { pos: Float32Array; width: Float32Array; inv: number; buckets: Map<string, number[]> };

const gridKey = (gx: number, gy: number, gz: number): string => `${gx}|${gy}|${gz}`;

/** Hash the drawn river vertices (strength ≥ `minStrength`) into a cube grid of edge `cellSize`; null if none. */
export function buildRiverGrid(positions: Float32Array, widths: Float32Array, minStrength: number, cellSize: number): RiverGrid | null {
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

/** Nearest drawn river vertex to unit point `p` within the 3×3×3 bucket neighbourhood: its squared chord
 *  distance, position, and flow strength (width) — or null if none near / no grid. */
export function nearestRiverVertex(p: Vec3, grid: RiverGrid | null): { chord2: number; pt: Vec3; width: number } | null {
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

// ===================== Shore snap =====================
// March from a settlement point toward the water along a precomputed water DIRECTION (the unit vector from
// its base cell to the nearest water cell), stopping just on the LAND side of where the FINE elevation field
// crosses sea level — the exact waterline the renderer draws. So the marker sits right at the water, never
// stranded out in it (the coarse cell boundary often falls the wrong side of the fine coast).
const COAST_MARCH_STEP = 0.04;
const COAST_MARCH_MAX = 0.6; // a touch past the coarse cell radius — allow a modest seaward fine-coast bulge
const COAST_BISECT_STEPS = 5; // refine the land/water crossing to ≈ STEP/32 of the arc

/** Snap point `p` to the shore by marching toward `dir` (unit direction to the nearest water) until the fine
 *  field reads water, then bisecting back to just on the land side. `dir` zero (an inland cell) or `p` itself
 *  already reading water (a borderline cell) ⇒ keep `p`. */
function snapToShore(p: Vec3, dir: Vec3, fineLandAt: (q: Vec3) => boolean): Vec3 {
  if ((dir.x === 0 && dir.y === 0 && dir.z === 0) || !fineLandAt(p)) return p;
  const at = (t: number): Vec3 => Vec3.normalize({ x: p.x + t * dir.x, y: p.y + t * dir.y, z: p.z + t * dir.z });
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
}

// === River bucket thresholds, in base cell-spacings ===
const RIVER_ON_CELLS = 0.6; // a vertex within this makes a cell river-eligible (the river runs through it)
const RIVER_SNAP_CELLS = 1.0; // a placed river settlement snaps to a vertex within this
export const RIVER_GRID_CELLS = 1.5; // hash bucket edge (≥ SNAP, so the 3×3×3 scan never misses a near vertex)

/** The full set of field + water lookups `placeSettlements` + `finishSettlements` need, injected by the caller
 *  so the engine is pure + unit-testable with fakes. Built via `makeSettlementWorld`. */
export type SettlementWorld = {
  popDensityAt: (p: Vec3) => number; // people/km² at p, INCLUDING the coast/river + habitability weighting; 0 ⇒ water/uninhabitable
  countryAt: (p: Vec3) => number; // owning country index, or -1 (ocean / unclaimed)
  routeAt: (p: Vec3) => { anchor: Vec3; waterKind: SettlementWaterKind }; // snap to river/coast/lake or keep p
  fieldAt: (p: Vec3) => { cell: number; rawElevation: number; reportElevation: number; moisture: number; ice: number; coastDist: number; seaDist: number };
};

/** Build the one `SettlementWorld` from raw field + base-partition lookups. Written ONCE; the main thread and
 *  the worker each gather their own primitives (CPU calc, nearest-cell, the per-base-cell water arrays, the
 *  drawn-river grid) and call this, so density, routing, and snapping are bit-for-bit the same on both. */
export function makeSettlementWorld(ctx: {
  sampleCell: (p: Vec3) => { elevation: number; reportElevation: number; moisture: number; ice: number };
  seaLevel: number;
  nearestCell: (p: Vec3) => number;
  countryOf: Int32Array; // the grown base partition — every cell maps to a country
  coastDist: Int32Array; // hops to nearest water of ANY kind; -1 if the cell itself is water
  seaDist: Int32Array; // hops to nearest LARGE water (sea/ocean); -1 if none reachable
  coastDir: Float32Array; // 3 per cell: unit direction toward the nearest water cell (0,0,0 if not on a shore)
  riverGrid: RiverGrid | null; // the drawn large-river network, hashed
  cellSpacing: number; // base cell angular spacing (rad) — sets the river on/snap thresholds
  densityScale: number; // live GLOBAL_POPULATION_DENSITY
  coastStrength: number; // live POPULATION.COAST_STRENGTH
  coastFalloff: number; // live POPULATION.COAST_FALLOFF
  desertAversion: number; // live CITY.DESERT_AVERSION
  iceAversion: number; // live CITY.ICE_AVERSION
}): SettlementWorld {
  const { sampleCell, seaLevel, nearestCell, countryOf, coastDist, seaDist, coastDir, riverGrid } = ctx;
  const onRiver2 = (RIVER_ON_CELLS * ctx.cellSpacing) ** 2;
  const riverSnap2 = (RIVER_SNAP_CELLS * ctx.cellSpacing) ** 2;
  const latDegOf = (p: Vec3): number => (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI;

  return {
    countryAt: (p) => {
      const c = nearestCell(p);
      return c < 0 ? -1 : countryOf[c];
    },
    popDensityAt: (p) => {
      const f = sampleCell(p);
      if (f.elevation < seaLevel) return 0; // water
      const c = nearestCell(p);
      // A drawn river counts as being ON the water (hops 0), so riverbanks get the full coast bonus too.
      const nr = nearestRiverVertex(p, riverGrid);
      const hops = nr && nr.chord2 <= onRiver2 ? 0 : coastDist[c];
      const nearWater = Math.max(hops === 0 ? 1 : 0, Math.max(0, 1 - coastDist[c] / DRY_WATER_REACH));
      const suit = cellSuitability({ latDeg: latDegOf(p), reportElevation: f.reportElevation, moisture: f.moisture, slope: 0 }, seaLevel);
      const hab = habitabilityWeight(f.moisture, f.ice, nearWater, ctx.desertAversion, ctx.iceAversion);
      return ctx.densityScale * suit * hab * coastBonus(hops, ctx.coastStrength, ctx.coastFalloff);
    },
    routeAt: (p) => {
      const c = nearestCell(p);
      const nr = nearestRiverVertex(p, riverGrid);
      const bordersSea = seaDist[c] === 0; // the cell touches a large water body (sea/ocean)
      const onRiver = nr !== null && nr.chord2 <= riverSnap2;
      const dir: Vec3 = { x: coastDir[3 * c], y: coastDir[3 * c + 1], z: coastDir[3 * c + 2] };
      if (bordersSea) return { anchor: snapToShore(p, dir, (q) => sampleCell(q).elevation >= seaLevel), waterKind: "ocean" };
      if (onRiver) return { anchor: Vec3.normalize(nr!.pt), waterKind: "river" }; // snap onto the drawn river
      if (coastDist[c] === 0) return { anchor: snapToShore(p, dir, (q) => sampleCell(q).elevation >= seaLevel), waterKind: "lake" };
      return { anchor: p, waterKind: "none" };
    },
    fieldAt: (p) => {
      const f = sampleCell(p);
      const c = nearestCell(p);
      // `cell` is the LAND cell the settlement was accepted on (the pre-snap point) — a coastal settlement's
      // snapped anchor can sit nearest a WATER cell, so terrain/coast lookups must key off this, not the anchor.
      return { cell: c, rawElevation: f.elevation, reportElevation: f.reportElevation, moisture: f.moisture, ice: f.ice, coastDist: coastDist[c], seaDist: seaDist[c] };
    },
  };
}

/** One placed settlement, with the terrain fields a marker's profile (industries / fun fact / elevation)
 *  is built from — assembled into a marker by cityStats.buildSettlement. */
export type PlacedSite = {
  anchor: Vec3; // unit-sphere position, snapped to its water
  population: number;
  countryIndex: number;
  waterKind: SettlementWaterKind;
  cell: number; // the LAND base cell it was accepted on (pre-snap) — for terrain/coast lookups; not the snapped anchor's
  rawElevation: number;
  reportElevation: number;
  moisture: number;
  ice: number;
  coastDist: number;
  seaDist: number;
};

/** A settlement candidate before routing: its (jittered) position, its rank-size population, and its owning
 *  country. Cheap to produce (no water snap / terrain read yet) — a country's whole set is placed, then
 *  finished into PlacedSites. */
export type PlacedCandidate = { pos: Vec3; population: number; countryIndex: number };

// ===================== The rank-size law =====================

/** Dials for the one continuous settlement law (settings.CITIES). */
export type RankSizeDials = {
  largestCityShare: number; // rank-1 (capital) population as a share of the country's population
  rankFalloff: number; // Zipf exponent α in size(rank)=size1/rank^α — higher = more primate + fewer, evener counts
  minCityPop: number; // smallest settlement worth placing; the curve stops once size drops below this
  maxCities: number; // hard cap on one country's settlement count (a safety valve; rarely binds)
};

/** The rank-size populations for a country, LARGEST FIRST — the whole continuous law in one function:
 *  size(rank) = share·P / rank^α, emitted while ≥ minCityPop. Continuous in P (the country's population,
 *  itself global density × habitable area): raising it grows EVERY entry AND clears the floor at more ranks,
 *  so new small settlements appear at the bottom — no thresholds, no buckets. Always returns ≥ 1 entry (the
 *  capital), even for a near-empty country, so every country keeps one. */
export function rankSizePopulations(population: number, d: RankSizeDials): number[] {
  const size1 = Math.max(1, d.largestCityShare * population);
  const floor = Math.max(1, d.minCityPop);
  const lastRank = Math.floor((size1 / floor) ** (1 / d.rankFalloff)); // last rank whose size is still ≥ floor
  const count = Math.max(1, Math.min(Math.round(d.maxCities), lastRank));
  const out: number[] = new Array(count);
  for (let r = 1; r <= count; r++) out[r - 1] = size1 / r ** d.rankFalloff;
  return out;
}

// ===================== Placement — biggest cities on the best, well-spaced land =====================
// The angular footprint a settlement reserves around itself, in multiples of the base cell spacing (so it's
// resolution-independent), is the LARGER of two terms:
//   • a per-country BASE footprint (`baseCells`) sized so the whole set roughly tiles the country's habitable
//     land — this is what SPREADS the long tail of small towns out instead of letting them pack the single
//     densest blob (the clumping fix); and
//   • a per-size term ∝ √population, so big cities additionally push each other apart.
// Without the base term, small towns collapse to a 1-cell footprint and greedy densest-first placement packs
// them all into the best region; the base term forces them to cover the country.
const footprintAngle = (population: number, spacingCells: number, baseCells: number, cellSpacingRad: number): number =>
  cellSpacingRad * Math.max(baseCells, spacingCells * Math.sqrt(population / 1e6));

// A cube-grid spatial hash over unit-sphere points — the O(1) "is anything already placed within r" spacing
// test. Bucket edge = the largest footprint, so any query radius (≤ that) is covered by the 3×3×3
// neighbourhood. Distances are squared chords (≈ angle for the small angles here).
class PointHash {
  private readonly buckets = new Map<string, Vec3[]>();
  private readonly inv: number;
  constructor(cellSize: number) {
    this.inv = 1 / Math.max(1e-6, cellSize);
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.round(x * this.inv)}|${Math.round(y * this.inv)}|${Math.round(z * this.inv)}`;
  }
  insert(p: Vec3): void {
    const k = this.key(p.x, p.y, p.z);
    const b = this.buckets.get(k);
    if (b) b.push(p);
    else this.buckets.set(k, [p]);
  }
  /** True if any inserted point lies within angular radius `angle` of `p`. */
  hasWithin(p: Vec3, angle: number): boolean {
    const chord2 = (2 * Math.sin(angle / 2)) ** 2;
    const gx = Math.round(p.x * this.inv), gy = Math.round(p.y * this.inv), gz = Math.round(p.z * this.inv);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const b = this.buckets.get(`${gx + dx}|${gy + dy}|${gz + dz}`);
          if (!b) continue;
          for (const q of b) {
            const ex = q.x - p.x, ey = q.y - p.y, ez = q.z - p.z;
            if (ex * ex + ey * ey + ez * ez <= chord2) return true;
          }
        }
    return false;
  }
}

const jitterOnSphere = (p: Vec3, amp: number, rng: RNG): Vec3 =>
  amp <= 0 ? p : Vec3.normalize({ x: p.x + (rng() - 0.5) * amp, y: p.y + (rng() - 0.5) * amp, z: p.z + (rng() - 0.5) * amp });

/**
 * Place a country's rank-size settlements on its most habitable, well-spaced land. `cells` are the country's
 * land cells; each is scored by the population-density field (`world.popDensityAt` — ALL the habitability
 * logic: suitability, coast, river, anti-desert, anti-ice). Walking cells best-first, the next (descending)
 * rank-size population is assigned to each cell that clears its FOOTPRINT from the settlements already placed.
 * The footprint carries a per-country BASE spacing sized so the set roughly TILES the habitable land, so the
 * long town tail spreads across the whole country instead of packing its single densest blob (`spread`);
 * bigger cities push apart a bit more (`spacingCells`). The capital takes the single best spot. A small
 * deterministic ± wobble jitters each size + position. Returns candidates LARGEST FIRST (out[0] = the
 * capital). Pure + deterministic.
 */
export function placeSettlements(args: {
  cells: number[];
  siteOf: (cell: number) => Vec3;
  world: SettlementWorld;
  countryIndex: number;
  populations: number[]; // rank-size sizes, largest first (rankSizePopulations)
  spacingCells: number; // CITIES.SPACING — a megacity's extra footprint in base-cell-spacings
  spread: number; // CITIES.SPREAD — how strongly the set tiles the country (0 = clump in the best land, 1 = even)
  sizeJitter: number; // ± fractional size wobble, deterministic per settlement
  cellSpacingRad: number; // base cell angular spacing — sets the tiling scale + jitter amplitude
  seed: string;
}): PlacedCandidate[] {
  const { cells, siteOf, world, countryIndex, populations, spacingCells, spread, sizeJitter, cellSpacingRad, seed } = args;
  if (cells.length === 0 || populations.length === 0) return [];
  const jig = (pop: number, i: number): number => {
    const rng = makeRNG(`${seed}|size|${i}`);
    return Math.max(1, Math.round(pop * (1 + (rng() - 0.5) * 2 * sizeJitter)));
  };
  // Score every land cell by the density field; keep the habitable ones (density > 0), best first.
  const scored: { pos: Vec3; d: number }[] = [];
  for (const c of cells) {
    const pos = siteOf(c);
    const d = world.popDensityAt(pos);
    if (d > 0) scored.push({ pos, d });
  }
  scored.sort((a, b) => b.d - a.d);
  // No habitable cell anywhere (a fully frozen / arid country): still give it its capital at the least-bad
  // cell, so every country keeps one.
  if (scored.length === 0) {
    let best = cells[0], bestD = -Infinity;
    for (const c of cells) {
      const d = world.popDensityAt(siteOf(c));
      if (d > bestD) { bestD = d; best = c; }
    }
    return [{ pos: siteOf(best), population: jig(populations[0], 0), countryIndex }];
  }
  // BASE footprint: the spacing (in cells) at which `populations.length` disks tile the `scored.length`
  // habitable cells — so the set spreads to cover the country. `spread` scales it (0 → 1-cell = clumps in the
  // best land; 1 → full tiling = even coverage). This is the floor the small-town tail spaces by.
  const baseCells = Math.max(1, spread * Math.sqrt(scored.length / populations.length));
  const foot = (rank: number): number => footprintAngle(populations[rank], spacingCells, baseCells, cellSpacingRad);
  const hash = new PointHash(foot(0));
  const out: PlacedCandidate[] = [];
  for (const s of scored) {
    if (out.length >= populations.length) break;
    const rank = out.length;
    if (hash.hasWithin(s.pos, foot(rank))) continue;
    hash.insert(s.pos);
    out.push({
      pos: jitterOnSphere(s.pos, cellSpacingRad * 0.4, makeRNG(`${seed}|pos|${rank}`)),
      population: jig(populations[rank], rank),
      countryIndex,
    });
  }
  // Spacing can reject everything past the first on a one-cell country — guarantee the capital regardless.
  if (out.length === 0) out.push({ pos: scored[0].pos, population: jig(populations[0], 0), countryIndex });
  return out;
}

/** Route + read terrain for placed candidates → full PlacedSites: snap each onto its river / sea shore /
 *  lakeshore (or leave it inland) and read its land cell's terrain fields for the marker profile. */
export function finishSettlements(cands: PlacedCandidate[], world: SettlementWorld): PlacedSite[] {
  return cands.map((c) => {
    const { anchor, waterKind } = world.routeAt(c.pos);
    return { anchor, population: c.population, countryIndex: c.countryIndex, waterKind, ...world.fieldAt(c.pos) };
  });
}

// ===================== PlacedSite vocabulary + zoom-reveal ladder =====================
// Population → words + LOD level, shared by the marker subtitle (CityMarkers), the fun-fact wording
// (funFact), and the reveal ladder (cityStats). Pure number maps with no dependency on the rest of the
// cluster.

// The size word a settlement goes by, purely by head count — the NOUN the popup subtitle + fun facts use,
// distinct from SettlementTier (marker size) and the reveal level below.
export type SettlementClass = "hamlet" | "village" | "town" | "city" | "metropolis";

export function settlementClass(population: number): SettlementClass {
  if (population >= 1_000_000) return "metropolis";
  if (population >= 100_000) return "city";
  if (population >= 1_000) return "town";
  if (population >= 100) return "village";
  return "hamlet";
}

// Whole-word "town"/"city" (with an optional possessive "'s"), but NOT closed compounds (townsfolk) or
// plurals (towns, cities — which refer to OTHER places). Lowercase-only by design (all-lowercase house style).
const SETTLEMENT_WORD = /\b(?:town|city)('s)?\b/g;

/** Rewrite the generic "town"/"city" in a rendered fun fact to the population-appropriate noun, so a place of
 *  80 reads as a "hamlet" and one of two million a "metropolis". Possessives keep their "'s". */
export function applySettlementNoun(text: string, population: number): string {
  const noun = settlementClass(population);
  return text.replace(SETTLEMENT_WORD, (_match: string, poss: string | undefined) => noun + (poss ?? ""));
}

/** The lowest LOD level a marker shows at, by population — biggest first on the globe, the long small-town
 *  tail only as you zoom in. Finer than SettlementClass so the reveal is gradual. Tops out at level 6
 *  (renderer/LodPipeline); capitals are forced to level 1 by the caller. */
export function minLevelForPopulation(population: number): number {
  if (population >= 50_000) return 1;
  if (population >= 16_000) return 2;
  if (population >= 5_000) return 3;
  if (population >= 2_000) return 4;
  if (population >= 800) return 5;
  return 6;
}
