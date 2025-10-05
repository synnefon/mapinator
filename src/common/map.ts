import { type BiomeConfig } from "./biomes";

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
    test?:number;
}

export interface Map extends BaseMap {
    elevations: number[];
    moistures: number[];
    biomes: BiomeConfig[];
}

