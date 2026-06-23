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
    elevation: Float32Array; // [0,1] raw elevation (pre sea-level contrast)
    moisture: Float32Array; // [0,1] already-contrasted moisture
    ice: Float32Array; // [0,1] polar ice-cap mask (1 = full ice)
    shade: Float32Array; // [0,1] baked relief hillshade (1 = lit, FLOOR = shadowed); a draw-time colour multiply
    plate: Uint16Array; // tectonic-plate index per cell (for the "view plates" render overlay)
    // Plate-motion arrows for the "view plates" overlay (identical for every rung): flat [x,y,z,…]
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
}

