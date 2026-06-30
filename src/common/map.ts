import type { Vec3 } from "./3DMath";

// === Globe model ===

// One Voronoi cell before packing: its site and the polygon ring around it (Vec3s
// on the unit sphere). Produced by the global/local meshers, consumed by packMesh.
export type MeshCell = { site: Vec3; ring: Vec3[] };

// Typed-array-backed globe: every per-cell field lives in a flat array for
// cache-friendly iteration, low GC pressure, and zero-copy transfer from the
// generation worker. A cell's polygon ring is the slice
// ringVerts[3*ringOffsets[i] .. 3*ringOffsets[i+1]).
export interface GlobeMap {
    cellCount: number;
    sites: Float32Array; // 3 per cell: [x,y,z, …] — Voronoi site / cell center
    ringOffsets: Uint32Array; // cellCount+1 prefix offsets (in vertices) into ringVerts
    ringVerts: Float32Array; // 3 per vertex: each cell's closed polygon ring
    elevation: Float32Array; // [0,1] raw elevation (pre sea-level contrast) — drives land/water + colour
    // Display-only elevation: the rendered `elevation` caps ALL non-mountain land at one height (so flat
    // land reads as a single green band), which makes every flat cell share ONE value. This restores a
    // continentalness-driven inland rise (+ the real mountain relief on top) so stats/labels — e.g. a
    // city's metres — vary across flat land. NEVER feeds rendering or land/water (see reportElevationAt).
    reportElevation: Float32Array; // [0,1]
    moisture: Float32Array; // [0,1] already-contrasted moisture
    ice: Float32Array; // [0,1] polar ice-cap mask (1 = full ice) — population/rivers only; biome colour is koppenZone
    koppenZone: Float32Array; // per-cell Köppen climate zone index (KZ.* in common/koppen) — the biome COLOUR + LABEL source
    shade: Float32Array; // [0,1] baked relief hillshade (1 = lit, FLOOR = shadowed); a draw-time colour multiply
    plate: Uint16Array; // tectonic-plate index per cell (for the "tectonic plates" render overlay)
    // Plate-motion arrows for the "tectonic plates" overlay (identical for every rung): flat [x,y,z,…]
    // tail positions + unit tangent directions, one entry per arrow, sampled along plate leading
    // edges. NOT transferred (small + memoized worker-side), so postMessage structured-clones them.
    arrowPositions: Float32Array;
    arrowDirections: Float32Array;
    rainfall: number; // per-seed wet/dry bias, consumed at render time
    pointCount: number;
    // Max chord from any site to its own ring verts → a conservative per-cell
    // bounding radius the renderer scales to px to cull off-screen cells early.
    maxRingRadius: number;
    // Local patches only: the spherical cap they cover, so the renderer can
    // occlusion-cull the global base cells hidden beneath the patch.
    cap?: { center: Vec3; cosKeep: number };
    // The exact generation request (whole-globe ⇒ halfAngle ≥ π), recorded so a worker can reproduce
    // this EXACT mesh deterministically for the off-thread country re-grow (cell order must match).
    genHalfAngle?: number;
    genPoints?: number;
    // Detail patches only: per-cell owning country (index, matching CountryInfo.index; -1 = unclaimed),
    // stamped AT GENERATION by sampling the broadcast grown base partition (nearest base cell). Lets the
    // choropleth fill + highlight colour each cell correctly the instant the mesh exists — no async re-grow.
    countryOf?: Int32Array;
}

/** What a worker needs to seed an off-thread patch re-grow AND to grow the patch-local settlement tail with
 *  the SAME engine + routes the main thread used for the big-city head: the base cells' sites + per-cell
 *  grown country, the live waterline, and the per-base-cell water arrays + drawn-river network the settlement
 *  engine routes + biases on (computed on main where the mesh adjacency lives). Broadcast to the worker pool
 *  (like params) whenever the assignment changes. */
export type CountrySeeds = {
    sites: Float32Array;
    countryOf: Int32Array; // the grown base partition (every cell → a country) the workers sample from
    seaLevel: number;
    coastDist: Int32Array; // per cell: hops to nearest water of any kind (-1 = water) — the engine's water bias
    seaDist: Int32Array; // per cell: hops to nearest LARGE water (-1 = none) — the sea/lake split
    coastDir: Float32Array; // 3 per cell: unit direction to nearest water — the shore snap marches along it
    riverPositions: Float32Array; // the drawn large-river network (rivers.ts): 3 per vertex
    riverWidths: Float32Array; // 1 per vertex, normalized flow strength — river settlements snap to it
    // True only when `sites` differs from the last broadcast (a new base map), false on a feature-only
    // re-derive (sea level / language / dials). Lets each worker skip rebuilding its base KD-tree (an
    // O(n log n) sort) when the sites are unchanged — structured clone gives a fresh array each time, so
    // the worker can't tell by identity. Set by main, which holds the canonical base map.
    baseChanged: boolean;
};

/** The patch-local settlement tail for one in-view region, grown off-thread (mapWorker `towns` job) by the
 *  one settlement engine. Flat, transferable arrays: anchor xyz + population + owning country per settlement,
 *  plus its water kind + the terrain fields the main thread builds the SAME marker profile from (so a tail
 *  town and a head city are assembled identically — no distinction). */
export type TownFieldData = {
    positions: Float32Array; // [x0,y0,z0, x1,y1,z1, …] unit-sphere anchors (snapped to water)
    populations: Float32Array;
    countries: Int32Array; // owning country index per town (matches countryOf / CountryInfo.index)
    waterKind: Uint8Array; // SETTLEMENT_WATER_KINDS index per town — the river/lake/coastal flavour split
    rawElevation: Float32Array; // terrain fields per town → the marker's biome/industries/fun fact/elevation
    reportElevation: Float32Array;
    moisture: Float32Array;
    ice: Float32Array;
    coastDist: Int32Array;
    seaDist: Int32Array;
};

