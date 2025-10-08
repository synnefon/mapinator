// PointGenerator.ts
import { Delaunay, type Delaunay as DelaunayT } from "d3-delaunay";
import type { Point } from "../common/map";
import { makeRNG, type RNG } from "../common/random";
import type { MapGenSettings } from "../common/settings";

type PointGenReturn = {
  centers: Point[];
  delaunay: DelaunayT<Point>;
};

export class PointGenerator {
  private rng: RNG = () => 0;
  private seed: string;

  constructor(seed: string) {
    this.seed = seed;
  }
  public reSeed(seed: string) {
    this.seed = seed;
  }

  public genPoints(settings: MapGenSettings): PointGenReturn {
    // Make generation deterministic for a given resolution
    this.rng = makeRNG(`${this.seed}-${settings.resolution}`);
    const { resolution, jitter } = settings;

    // Initial jittered grid
    const points = this.initPoints(resolution, jitter);

    // Lloyd relaxation (N steps) using Voronoi cell polygons
    const { centers, delaunay } = this.relaxPoints(points, 4, resolution);

    return { centers, delaunay };
  }

  public genPointsForRegion(
    settings: MapGenSettings,
    worldX: number,
    worldY: number,
    width: number,
    height: number,
    spacing: number
  ): Point[] {
    this.rng = makeRNG(
      `${this.seed}-${settings.resolution}-${worldX}-${worldY}`
    );
    const { jitter } = settings;
    const points: Point[] = [];

    const startX = Math.floor(worldX / spacing) * spacing;
    const startY = Math.floor(worldY / spacing) * spacing;
    const endX = worldX + width;
    const endY = worldY + height;

    for (let x = startX; x <= endX; x += spacing) {
      for (let y = startY; y <= endY; y += spacing) {
        const jx = x + jitter * spacing * (this.rng() - this.rng());
        const jy = y + jitter * spacing * (this.rng() - this.rng());
        points.push({ x: jx, y: jy });
      }
    }
    return points;
  }

  // ---- Lloyd relaxation using d3-delaunay Voronoi ----
  private relaxOnce(points: Point[], bbox: [number, number, number, number]) {
    const delaunay = Delaunay.from(
      points,
      (p) => p.x,
      (p) => p.y
    ) as DelaunayT<Point>;
    const vor = delaunay.voronoi(bbox); // clip to bounds so polygons are closed
    const centers = new Array<Point>(points.length);

    for (let i = 0; i < points.length; i++) {
      const poly = vor.cellPolygon(i); // Array<[x, y]> for cell i
      if (!poly || poly.length < 3) {
        centers[i] = points[i]; // degenerate; keep original
        continue;
      }
      const c = this.polygonCentroidXY(poly);
      centers[i] = { x: c[0], y: c[1] };
    }
    return { centers, delaunay };
  }

  private relaxPoints(points: Point[], iterations: number, resolution: number) {
    let pts = points;
    let last: DelaunayT<Point> | undefined;
    // Bound the Voronoi to your map plane; polygons get clipped and closed.
    const bbox: [number, number, number, number] = [
      0,
      0,
      resolution,
      resolution,
    ];

    for (let k = 0; k < iterations; k++) {
      const step = this.relaxOnce(pts, bbox);
      pts = step.centers;
      last = step.delaunay;
    }
    if (!last) throw new Error("No triangulation produced");
    return { centers: pts, delaunay: last };
  }

  private initPoints(resolution: number, jitter: number): Point[] {
    const points: Point[] = [];
    for (let x = 0; x < resolution; x++) {
      for (let y = 0; y < resolution; y++) {
        const jx = x + jitter * (this.rng() - this.rng());
        const jy = y + jitter * (this.rng() - this.rng());
        points.push({ x: jx, y: jy });
      }
    }
    return points;
  }

  // Fast centroid for Array<[x,y]>
  private polygonCentroidXY(verts: Array<[number, number]>): [number, number] {
    let A = 0,
      cx = 0,
      cy = 0;
    const n = verts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [x0, y0] = verts[j];
      const [x1, y1] = verts[i];
      const cross = x0 * y1 - x1 * y0;
      A += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (Math.abs(A) < 1e-12) return verts[0]; // fallback
    const area = A / 2;
    return [cx / (6 * area), cy / (6 * area)];
  }
}
