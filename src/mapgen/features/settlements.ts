import { Vec3 } from "../../common/3DMath";
import { makeRNG } from "../../common/random";
import { cellSuitability } from "./suitability";

// ===================== The one settlement engine =====================
// EVERY settlement on the map — the big cities shown from the globe AND the small-town tail revealed on
// zoom — comes out of this one engine, placed by the SAME routes. There is no longer a "city" algorithm
// and a separate "town" algorithm: there is a single deterministic field, sampled over whatever spherical
// cap the caller wants, in whatever population window the caller wants. The head (big cities) is the field
// over the WHOLE sphere at/above the global split; the tail (towns) is the field over the in-view cap below
// it. Both run `growSettlements` against the SAME `SettlementWorld`, so both cluster on water and snap to
// the coast/river/lakeshore identically.
//
// The field is a global jittered lat/lon grid. Each cell, by its own seeded RNG, gets a jittered position, a
// settlement size (lognormal village/town body + Pareto city tail, see `sizeOf`), and an accept roll ∝ local
// population density — which now INCLUDES the coast + river bonus, so settlements cluster on the water the
// way real ones did. An accepted settlement is then ROUTED: snapped onto the drawn river, the sea shore, or
// the lakeshore it sits by (or left inland), exactly as the big cities always were. Pure + deterministic
// (no field/DOM/country logic of its own): the caller injects a `SettlementWorld` of field + water lookups,
// so the whole thing is unit-testable with fakes and runs identically on the main thread and the worker.

// The water a settlement sits on, by priority sea > large river > other water (lake/pond) > none. Drives the
// riverside/coastal flavour split + (for big cities) a debug tint on the marker.
export type SettlementWaterKind = "ocean" | "river" | "lake" | "none";

// Stable index encoding of SettlementWaterKind for zero-copy transfer of the tail field between worker +
// main (TownFieldData.waterKind) — packed by indexOf on the worker, unpacked by index on the main thread.
export const SETTLEMENT_WATER_KINDS: SettlementWaterKind[] = ["ocean", "river", "lake", "none"];

// Marker size class, by population — drives the dot's CSS class + flavour gating (NOT the size noun, which
// keys on population via settlementClass, nor the zoom-reveal level, via minLevelForPopulation).
export type SettlementTier = "big" | "medium" | "small";

/** A settlement marker: a point inside a country, sized + zoom-gated, with a generated name and an estimated
 *  population. `anchor` is a unit-sphere point, snapped to its water. Carries the displayable extras the click
 *  card shows. The big-city HEAD and the patch-local town tail produce IDENTICAL Settlement objects from the same
 *  engine — see cityStats.assembleHeadCities (head) and RegionTownLayer (tail). */
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

// ===================== PlacedSite-size law (Eeckhout 2004 / Gabaix) =====================
// The BODY is lognormal (villages, the rural ~90%); the upper TAIL is Pareto (the few towns/cities). A pure
// power law over-counts small towns, so most draws are the lognormal body and a small fraction come from the
// Pareto tail, giving towns/cities up to the ceiling at the right (heavier-than-lognormal) frequency.
const ABS_MIN_POP = 30; // smallest hamlet the field places (lognormal lower clamp)
const LOGNORMAL_MU = 5.5; // ln-mean → median settlement ≈ e^5.5 ≈ 245 (a village), grounded to ~1400
const LOGNORMAL_SIGMA = 1.0; // ln-spread (tighter than modern's ~1.75 — medieval was flatter + smaller)
const TAIL_FRACTION = 0.015; // share drawn from the Pareto city tail (≈ the ~1–2% of places that were towns)
const TAIL_CROSSOVER = 3_000; // where the body hands off to the tail (town → city)
const TAIL_ALPHA = 1.2; // Pareto CCDF exponent for the city tail (~1400 flatter than the modern ~1.4)
// Density calibration: emitted settlement density = popDensity × cellArea / perCapita × this. 1 ≈ exactly
// the per-capita target; nudge to taste against the live count.
const DENSITY_TUNING = 1;

// A standard normal via Box–Muller (consumes two uniforms). Deterministic in `rng`.
const gaussian = (rng: () => number): number =>
  Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

/** PlacedSite size in [ABS_MIN_POP, ceiling): a lognormal village/town body with a Pareto city tail, so most
 *  are villages and a few are towns/cities up to the ceiling. Deterministic in `rng`, so a cell's size is
 *  fixed regardless of which window (head/tail) or zoom level queried it. */
export const sizeOf = (rng: () => number, ceiling: number): number => {
  if (rng() < TAIL_FRACTION) {
    const city = TAIL_CROSSOVER * Math.pow(1 - rng(), -1 / TAIL_ALPHA); // Pareto upper tail
    return Math.min(ceiling - 1, Math.round(city));
  }
  const body = Math.exp(LOGNORMAL_MU + LOGNORMAL_SIGMA * gaussian(rng)); // lognormal body
  return Math.max(ABS_MIN_POP, Math.min(ceiling - 1, Math.round(body)));
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

// The coast/river population multiplier from BFS hops to the nearest water (0 = on the shore). Pre-modern
// trade + fishing clustered people on the water; the bonus fades exponentially inland. A drawn river counts
// as hops 0 (you're ON the water), so riverbanks get the full bonus too. Mirrors suitability.ts:coastBonus
// but takes its dials explicitly, so the worker (whose settings copy is stale) uses the SAME live values the
// main thread does — no head/tail divergence in how strongly water pulls settlements.
const coastBonus = (hops: number, strength: number, falloff: number): number =>
  hops < 0 ? 1 : 1 + strength * Math.exp(-hops / falloff);

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

/** The full set of field + water lookups `growSettlements` needs, injected by the caller so the same engine
 *  runs on the main thread (head) and the worker (tail). Both build it via `makeSettlementWorld`. */
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

const latLonToVec3 = (lat: number, lon: number): Vec3 => {
  const c = Math.cos(lat);
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: c * Math.sin(lon) };
};

/** One placed settlement, with the terrain fields a marker's profile (industries / fun fact / elevation)
 *  is built from — so the head builds them on the spot and the worker ships them back for the tail. */
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

/**
 * Materialise the settlements of one spherical cap in one population window from the global deterministic
 * field. Iterates the jittered lat/lon grid over the cap; each cell deterministically decides its position +
 * size, is dropped outside [minPop, ceilingPop) (the head takes ≥ the split, the tail below it) BEFORE any
 * field lookup, then kept ON LAND with probability ∝ local population density (coast/river-boosted, so the
 * spread tracks the 1400 pattern). Each survivor is ROUTED — snapped onto its river / sea shore / lakeshore.
 * Deterministic per GLOBAL cell id, so panning/zooming reveals the SAME settlements in place. Pure: all field
 * + water access is through `world`.
 */
export function growSettlements(args: {
  center: Vec3; // unit-sphere cap centre (any point when capAngle ≥ π — the whole-sphere head)
  capAngle: number; // angular radius of the region (rad); ≥ π ⇒ the whole sphere
  gridAngle: number; // candidate spacing (rad) — coarse for the head, fine for the deepest tail level
  minPop: number; // only emit settlements at least this big (the head split / per-level LOD floor)
  ceilingPop: number; // only emit settlements below this (the head's handoff to nothing ⇒ Infinity)
  perCapita: number; // people per settlement — the density target (1400 village body ≈ 600)
  planetRadiusKm: number;
  world: SettlementWorld;
  seed: string;
}): PlacedSite[] {
  const { center, capAngle, gridAngle, minPop, ceilingPop, perCapita, planetRadiusKm, world, seed } = args;
  const out: PlacedSite[] = [];
  const cosCap = Math.cos(capAngle);
  const cLat = Math.asin(Math.max(-1, Math.min(1, center.y)));
  const cLon = Math.atan2(center.z, center.x);
  const r2 = planetRadiusKm * planetRadiusKm;
  // Longitude WRAPS, so the grid must tile the circle exactly: snap to a whole number of cells and index
  // them modulo that count, so a cap straddling the ±π seam picks the SAME cell id on either side (no
  // reshuffle as you pan across it). Latitude doesn't wrap, so it keeps the raw gridAngle grid.
  const nLon = Math.max(1, Math.round((2 * Math.PI) / gridAngle));
  const lonStep = (2 * Math.PI) / nLon;

  const latStart = Math.floor((cLat - capAngle) / gridAngle);
  const latEnd = Math.ceil((cLat + capAngle) / gridAngle);
  for (let li = latStart; li <= latEnd; li++) {
    const lat = li * gridAngle;
    if (lat <= -Math.PI / 2 || lat >= Math.PI / 2) continue;
    const cosLat = Math.max(1e-3, Math.cos(lat));
    // cos(lat)-corrected cell area: the lat/lon grid is finer near the poles, but the area shrinks to match,
    // so the accept probability — and thus the realised density — stays correct at every latitude.
    const cellAreaKm2 = gridAngle * lonStep * cosLat * r2;
    const lonHalf = capAngle / cosLat + gridAngle; // generous lon span; the true-angle test below culls it
    const lonStart = Math.floor((cLon - lonHalf) / lonStep);
    let lonEnd = Math.ceil((cLon + lonHalf) / lonStep);
    if (lonEnd - lonStart + 1 > nLon) lonEnd = lonStart + nLon - 1; // a polar cap can wrap the circle — one ring max
    for (let oi = lonStart; oi <= lonEnd; oi++) {
      const oiw = ((oi % nLon) + nLon) % nLon; // wrap to [0,nLon): same spot ⇒ same cell id either side of ±π
      const rng = makeRNG(`${seed}|${li}|${oiw}`); // GLOBAL cell id ⇒ the same settlement wherever the cap falls
      const jLat = lat + (rng() - 0.5) * gridAngle;
      const jLon = oiw * lonStep + (rng() - 0.5) * lonStep;
      const pos = latLonToVec3(jLat, jLon);
      if (Vec3.dot(pos, center) < cosCap) continue; // outside the cap
      const population = sizeOf(rng, ceilingPop);
      if (population < minPop || population >= ceilingPop) continue; // outside this window's pop band — skip before lookups
      const ci = world.countryAt(pos);
      if (ci < 0) continue; // ocean / unclaimed
      const density = world.popDensityAt(pos);
      if (density <= 0) continue; // water / uninhabitable
      const accept = (density * cellAreaKm2 * DENSITY_TUNING) / perCapita;
      if (rng() >= accept) continue; // keep ∝ local population ⇒ ~1400 per-capita density
      const { anchor, waterKind } = world.routeAt(pos);
      const f = world.fieldAt(pos);
      out.push({ anchor, population, countryIndex: ci, waterKind, ...f });
    }
  }
  return out;
}

// ===================== PlacedSite vocabulary + zoom-reveal ladder =====================
// Population → words + LOD level, shared by the marker subtitle (CityMarkers), the fun-fact wording
// (funFact), and the reveal ladder (cityStats). Pure number maps with no dependency on the rest of the
// cluster.

// The size word a settlement goes by, purely by head count — the NOUN the popup subtitle + fun facts use,
// distinct from SettlementTier (marker size) and the reveal level below.
export type SettlementClass = "hamlet" | "village" | "town" | "city" | "metropolis";

// The FLOOR of the split between the GLOBAL big-city head (the field over the sphere) and the PATCH-LOCAL
// tail (the field over the view). 5,000 is the historian's "city" threshold (Bairoch). The live split is
// globalCityMinPop().
export const GLOBAL_CITY_MIN_POP = 5_000;

// The population density (people/km²) at which the 5,000 floor yields a renderable global count — the ~1400
// land average the model is calibrated to. Keeps the head's marker count bounded as density climbs.
export const CITY_DENSITY_REFERENCE = 2.6;

/** The live global/patch split, scaled with density: holding S = floor·(density/reference) keeps the GLOBAL
 *  head count ~constant no matter how dense the world — denser planets push more mid-cities into the bounded
 *  patch-local tail while the largest stay global. At/below the reference density it's just the 5k floor. */
export function globalCityMinPop(density: number): number {
  return GLOBAL_CITY_MIN_POP * Math.max(1, density / CITY_DENSITY_REFERENCE);
}

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
