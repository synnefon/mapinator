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

export interface Map extends BaseMap {
    elevations: number[];
    moistures: number[];
}

