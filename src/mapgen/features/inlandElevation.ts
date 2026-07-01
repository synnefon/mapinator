import type { GlobeMap } from "../../common/map";
import { largeWaterMask, waterHopDistance } from "./adjacency";
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

/**
 * The continental inland rise as a STANDALONE display-elevation field: a fresh copy of
 * map.reportElevation with each land cell lifted by its graph distance to the nearest SEA cell
 * (0 on the shore, saturating inland) — lakes/ponds don't count, so a high mountain lake stays high.
 * `components` is the already-computed connected-component list (reused — no recompute) and `adjacency`
 * the cell graph.
 *
 * PURE — it returns a new array rather than mutating the map. So it's freely re-runnable (computeMapFeatures
 * re-runs on the same map on a language change; a recompute is deterministic, never additive-doubled),
 * and its dependency is NAMED at the call site: assignCountries / assignCities take this risen field as
 * an explicit input, so the ordering can't be silently reordered away.
 */
export function inlandRisenElevation(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  components: RawComponent[]
): Float32Array {
  const risen = new Float32Array(map.reportElevation); // copy — never mutate the generator's field

  if (!components.some((c) => c.cls === "water")) return risen; // a waterless world — no coast to rise from
  // "The sea": the largest water body, plus any other big enough to read as a sea rather than a pond —
  // the one definition, shared with the settlement water fields (adjacency.ts:largeWaterMask).
  const isSea = largeWaterMask(components, map.cellCount);

  // Graph hops from each land cell to the nearest sea cell: 0 on the shore, -1 if the sea is unreachable.
  const seaDist = waterHopDistance(map, seaLevel, adjacency, (i) => isSea[i] === 1);
  for (let i = 0; i < map.cellCount; i++) {
    if (map.elevation[i] < seaLevel) continue; // water cell — no elevation to raise
    // Unreachable from the sea (a landlocked or lake-only landmass) reads as deep interior.
    const hops = seaDist[i] < 0 ? RISE_SCALE_HOPS * 4 : seaDist[i];
    const rise = MAX_INLAND_RISE * (1 - Math.exp(-hops / RISE_SCALE_HOPS));
    risen[i] = Math.min(1, risen[i] + rise);
  }
  return risen;
}
