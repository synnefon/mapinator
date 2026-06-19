// Minimal ambient types for d3-geo-voronoi (the package ships no .d.ts).
// Declares only the surface we use: geoVoronoi(points).polygons().
declare module "d3-geo-voronoi" {
  type LonLat = [number, number];

  interface GeoVoronoiGeometry {
    type: string; // "Polygon" for normal cells; "Sphere" / null in degenerate cases
    coordinates?: LonLat[][]; // coordinates[0] = closed [lon,lat] ring
  }

  export interface GeoVoronoiPolygon {
    type: "Feature";
    geometry: GeoVoronoiGeometry | null;
    properties: {
      site: number;
      sitecoordinates: LonLat;
      neighbours: number[];
    };
  }

  export interface GeoVoronoiPolygons {
    type: "FeatureCollection";
    features: GeoVoronoiPolygon[];
  }

  export interface GeoVoronoi {
    polygons(): GeoVoronoiPolygons;
  }

  export function geoVoronoi(data?: LonLat[]): GeoVoronoi;
}
