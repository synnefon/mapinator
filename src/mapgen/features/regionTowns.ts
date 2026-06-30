import { Vec3 } from "../../common/3DMath";
import { makeRNG } from "../../common/random";

// ===================== Patch-local small towns =====================
// The small-town TAIL is too dense to ever hold globally (1400 density over a whole planet is millions of
// markers). Instead it's a DETERMINISTIC FIELD sampled only for the region in view: every point on the
// sphere either is or isn't a town, fixed by a hash of its grid cell — so panning/zooming reveals the SAME
// towns in place (no flicker, no reshuffle) while only the in-view region is ever materialised.
//
// The field is a global jittered lat/lon grid. Each cell, by its own seeded RNG, gets: a jittered position,
// a settlement size (a lognormal village/town body + a Pareto city tail, see sizeOf), and an accept roll ∝
// local population density — so towns cluster where people are (the same cellSuitability the country
// populations use), at ~1400 per-capita density. A per-level `minPop` floor is the zoom LOD: shallow zoom
// shows only the larger towns over a wide cap, deep zoom shows everything over a small one — both bounded
// counts. Pure + deterministic (no field/DOM/country logic of its own): the caller passes population
// density + country lookups, so the whole thing is unit-testable with fakes and runs identically on the worker.

export type RegionTown = {
  anchor: Vec3; // unit-sphere position
  population: number;
  countryIndex: number;
};

// The full settlement-size law (Eeckhout 2004: the BODY is lognormal; Gabaix / Clauset-Shalizi-Newman: the
// upper TAIL is Pareto). A pure power law over-counts small towns, so the body — villages, the rural ~90% —
// is lognormal, and a small fraction are drawn from a Pareto tail so towns/cities up to the ceiling appear
// at the right (heavier-than-lognormal) frequency.
const ABS_MIN_POP = 30; // smallest hamlet the field places (lognormal lower clamp)
const LOGNORMAL_MU = 5.5; // ln-mean → median settlement ≈ e^5.5 ≈ 245 (a village), grounded to ~1400
const LOGNORMAL_SIGMA = 1.0; // ln-spread (tighter than modern's ~1.75 — medieval was flatter + smaller)
const TAIL_FRACTION = 0.015; // share drawn from the Pareto city tail (≈ the ~1–2% of places that were towns)
const TAIL_CROSSOVER = 3_000; // where the body hands off to the tail (town → city)
const TAIL_ALPHA = 1.2; // Pareto CCDF exponent for the city tail (~1400 flatter than the modern ~1.4)
// Density calibration: emitted town density = popDensity × cellArea / perCapita × this. 1 ≈ exactly the
// per-capita target; nudge to taste against the live count.
const DENSITY_TUNING = 1;

const latLonToVec3 = (lat: number, lon: number): Vec3 => {
  const c = Math.cos(lat);
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: c * Math.sin(lon) };
};

// A standard normal via Box–Muller (consumes two uniforms). Deterministic in `rng`.
const gaussian = (rng: () => number): number =>
  Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

// Settlement size in [ABS_MIN_POP, ceiling): a lognormal village/town body with a Pareto city tail, so most
// are villages and a few are towns/cities up to the ceiling. Deterministic in `rng`, so a cell's size is
// fixed regardless of which zoom level queried it.
const sizeOf = (rng: () => number, ceiling: number): number => {
  if (rng() < TAIL_FRACTION) {
    const city = TAIL_CROSSOVER * Math.pow(1 - rng(), -1 / TAIL_ALPHA); // Pareto upper tail
    return Math.min(ceiling - 1, Math.round(city));
  }
  const body = Math.exp(LOGNORMAL_MU + LOGNORMAL_SIGMA * gaussian(rng)); // lognormal body
  return Math.max(ABS_MIN_POP, Math.min(ceiling - 1, Math.round(body)));
};

/**
 * Materialise the small towns of one spherical cap (the current view region) from the global deterministic
 * town field. Iterates the jittered lat/lon grid over the cap; each cell deterministically decides its
 * jittered position + power-law size, is dropped below `minPop` (the zoom LOD floor, cheaply — before any
 * field/country lookup), then kept ON LAND with probability ∝ local population density (so the spread
 * tracks the 1400 settlement pattern). Towns ≥ `ceilingPop` are left to the global big-city set.
 */
export function growRegionTowns(args: {
  center: Vec3; // unit-sphere view centre
  capAngle: number; // angular radius of the region (rad)
  gridAngle: number; // candidate spacing (rad) — the finest town spacing (deepest level)
  minPop: number; // per-level LOD floor — only emit towns at least this big
  ceilingPop: number; // handoff to the global set — only emit towns below this
  perCapita: number; // people per settlement (~1400 ≈ 17000) — the density target
  planetRadiusKm: number;
  popDensityAt: (p: Vec3) => number; // people/km² at p (0 ⇒ water / uninhabitable)
  countryAt: (p: Vec3) => number; // owning country index, or -1 if none (ocean / unclaimed)
  seed: string;
}): RegionTown[] {
  const { center, capAngle, gridAngle, minPop, ceilingPop, perCapita, planetRadiusKm, popDensityAt, countryAt, seed } = args;
  const towns: RegionTown[] = [];
  const cosCap = Math.cos(capAngle);
  const cLat = Math.asin(Math.max(-1, Math.min(1, center.y)));
  const cLon = Math.atan2(center.z, center.x);
  const r2 = planetRadiusKm * planetRadiusKm;
  // Longitude WRAPS, so the grid must tile the circle exactly: 2π is not a whole multiple of gridAngle, so
  // snap to a whole number of cells and index them modulo that count. Without this, a cap straddling the ±π
  // seam (where atan2 jumps +π↔-π) picks a DIFFERENT oi for the same spot on each side — so the whole strip
  // reshuffles as you pan across it. Latitude doesn't wrap, so it keeps the raw gridAngle grid.
  const nLon = Math.max(1, Math.round((2 * Math.PI) / gridAngle));
  const lonStep = (2 * Math.PI) / nLon;

  const latStart = Math.floor((cLat - capAngle) / gridAngle);
  const latEnd = Math.ceil((cLat + capAngle) / gridAngle);
  for (let li = latStart; li <= latEnd; li++) {
    const lat = li * gridAngle;
    if (lat <= -Math.PI / 2 || lat >= Math.PI / 2) continue;
    const cosLat = Math.max(1e-3, Math.cos(lat));
    // cos(lat)-corrected cell area: the lat/lon grid is finer near the poles, but the area shrinks to match,
    // so the accept probability — and thus the realised town density — stays correct at every latitude.
    const cellAreaKm2 = gridAngle * lonStep * cosLat * r2;
    const lonHalf = capAngle / cosLat + gridAngle; // generous lon span; the true-angle test below culls it
    const lonStart = Math.floor((cLon - lonHalf) / lonStep);
    let lonEnd = Math.ceil((cLon + lonHalf) / lonStep);
    // Near the poles the cap can wrap the whole circle; cap the scan at one full ring so no cell (and no
    // town) is emitted twice once indices are taken modulo nLon below.
    if (lonEnd - lonStart + 1 > nLon) lonEnd = lonStart + nLon - 1;
    for (let oi = lonStart; oi <= lonEnd; oi++) {
      const oiw = ((oi % nLon) + nLon) % nLon; // wrap to [0,nLon): same spot ⇒ same cell id either side of ±π
      const rng = makeRNG(`${seed}|${li}|${oiw}`); // GLOBAL cell id ⇒ the same town wherever the cap falls
      const jLat = lat + (rng() - 0.5) * gridAngle;
      const jLon = oiw * lonStep + (rng() - 0.5) * lonStep;
      const pos = latLonToVec3(jLat, jLon);
      if (Vec3.dot(pos, center) < cosCap) continue; // outside the cap
      const population = sizeOf(rng, ceilingPop);
      if (population < minPop) continue; // below this level's LOD floor — skip before the costly lookups
      const ci = countryAt(pos);
      if (ci < 0) continue; // ocean / unclaimed
      const density = popDensityAt(pos);
      if (density <= 0) continue; // water / uninhabitable
      const accept = (density * cellAreaKm2 * DENSITY_TUNING) / perCapita;
      if (rng() >= accept) continue; // keep ∝ local population ⇒ ~1400 per-capita density
      towns.push({ anchor: pos, population, countryIndex: ci });
    }
  }
  return towns;
}
