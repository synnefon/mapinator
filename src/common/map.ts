import type { Delaunay } from "d3-delaunay";

export interface Point {
    x: number;
    y: number;
}

export interface BaseMap {
    points: Point[];
    resolution: number;
    numRegions: number;
    numTriangles: number;
    numEdges: number;
    halfedges: Int32Array<ArrayBufferLike>;
    triangles: Uint32Array<ArrayBufferLike>;
    delaunay: Delaunay<Point>; // Cache d3-delaunay Delaunay (has .voronoi() method)
}

export interface WorldMap extends BaseMap {
    elevations: Float32Array;
    moistures: Float32Array;
    rainfall: number; // per-seed wet/dry bias, consumed at render time
}

// === Globe model ===
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

// One Voronoi cell on the globe: its site + polygon ring as unit-sphere vectors,
// plus raw elevation (pre sea-level contrast) and already-contrasted moisture.
export interface GlobeCell {
    site: Vec3;
    ring: Vec3[];
    elevation: number;
    moisture: number;
}

export interface GlobeMap {
    cells: GlobeCell[];
    rainfall: number; // per-seed wet/dry bias, consumed at render time
    pointCount: number;
}

