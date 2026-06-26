import type { GlobeMap } from "../../common/map";
import { waterHopDistance } from "./adjacency";
import type { RawComponent } from "./detect";

// A real continent-interior rise added to reportElevation: 0 at the sea, climbing and SATURATING with
// graph distance inland (real interiors plateau a few hundred metres up — steppe, high plains — they
// don't ramp forever). reportElevation already strips the rendering cap so flat land reads sea level;
// this restores the one thing genuinely true of flat land — interiors sit higher than coasts — WITHOUT
// the continentalness carrier (which doesn't track the real coastline, and previously leaked coastline-
// shaping noise as kilometres of altitude). Distance is GEOMETRIC (graph hops to the sea), so the rise
// is exactly 0 at the true shore. Display / stats / population only; never rendering or land/water.
const MAX_INLAND_RISE = 0.035; // normalised elevation; ≈ a ~600 m interior plateau above the coast
const RISE_SCALE_HOPS = 6; // e-folding distance: ~63% of the rise by this many hops inland, ~95% by 3×
const LARGE_WATER_FRAC = 0.01; // "the sea" = the biggest water body OR any ≥ this fraction (matches cities.ts)

// Applied at most once per map: reportElevation is a shared field and computeMapFeatures may re-run on
// the same map (e.g. a language change), so a second additive pass would double the rise. The WeakSet
// makes it idempotent — and deterministic across re-calls — without a flag on the GlobeMap type.
const risen = new WeakSet<GlobeMap>();

/**
 * Bake the continental inland rise into map.reportElevation (in place, once per map). `components` is the
 * already-computed connected-component list (reused — no recompute) and `adjacency` the cell graph. Each
 * land cell is lifted by its graph distance to the nearest SEA cell — lakes/ponds don't count, so a high
 * mountain lake stays high — leaving the whole ocean coast at 0 m and raising interiors to a gentle plateau.
 */
export function applyInlandRise(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  components: RawComponent[]
): void {
  if (risen.has(map)) return;
  risen.add(map);

  // "The sea": the largest water body, plus any other big enough to read as a sea rather than a pond.
  const water = components.filter((c) => c.cls === "water");
  if (water.length === 0) return; // a waterless world — no coast to rise from
  const largest = water.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  const threshold = LARGE_WATER_FRAC * map.cellCount;
  const isSea = new Uint8Array(map.cellCount);
  for (const comp of water) {
    if (comp === largest || comp.cells.length >= threshold) {
      for (const cell of comp.cells) isSea[cell] = 1;
    }
  }

  // Graph hops from each land cell to the nearest sea cell: 0 on the shore, -1 if the sea is unreachable.
  const seaDist = waterHopDistance(map, seaLevel, adjacency, (i) => isSea[i] === 1);
  for (let i = 0; i < map.cellCount; i++) {
    if (map.elevation[i] < seaLevel) continue; // water cell — no elevation to raise
    // Unreachable from the sea (a landlocked or lake-only landmass) reads as deep interior.
    const hops = seaDist[i] < 0 ? RISE_SCALE_HOPS * 4 : seaDist[i];
    const rise = MAX_INLAND_RISE * (1 - Math.exp(-hops / RISE_SCALE_HOPS));
    map.reportElevation[i] = Math.min(1, map.reportElevation[i] + rise);
  }
}
