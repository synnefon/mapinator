// === Globe model ===
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

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
    rainfall: number; // per-seed wet/dry bias, consumed at render time
    pointCount: number;
    // Local patches only: the spherical cap they cover, so the renderer can
    // occlusion-cull the global base cells hidden beneath the patch.
    cap?: { center: Vec3; cosKeep: number };
}

