// PointGenerator.ts
import { Delaunay, type Delaunay as DelaunayT } from "d3-delaunay";
import type { Point } from "../common/map";
import { makeRNG, type RNG } from "../common/random";
import type { MapSettings } from "../common/settings";

type PointGenReturn = {
  centers: Point[];
  delaunay: DelaunayT<any>;
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

  public genPoints(settings: MapSettings): PointGenReturn {
    // determinate per resolution
    this.rng = makeRNG(`${this.seed}-${settings.resolution}`);
    const { resolution, jitter } = settings;

    // 1) start with a jittered grid in Point[] (readable)
    const points = this.initPoints(resolution, jitter);

    // 2) build delaunay (it copies x/y into an internal Float64Array: delaunay.points)
    let delaunay = Delaunay.from(
      points,
      (p) => p.x,
      (p) => p.y
    );

    // 3) N iterations of in-place Lloyd relaxation using voronoi + update()
    const iterations = 4;
    const bbox: [number, number, number, number] = [
      0,
      0,
      resolution,
      resolution,
    ];

    for (let k = 0; k < iterations; k++) {
      const vor = delaunay.voronoi(bbox);

      // write new positions directly into delaunay.points (flat [x0,y0,x1,y1,...])
      const flat = delaunay.points as Float64Array;
      const n = flat.length / 2;

      for (let i = 0; i < n; i++) {
        const poly = vor.cellPolygon(i); // Array<[x,y]> or null
        if (poly && poly.length >= 3) {
          const [cx, cy] = this.polygonCentroidXY(poly);
          flat[2 * i] = cx;
          flat[2 * i + 1] = cy;
        } else {
          // Hull / degenerate: fall back to neighbor average to keep things stable
          const [ax, ay, count] = this.averageNeighborXY(delaunay, i);
          if (count > 0) {
            flat[2 * i] = ax;
            flat[2 * i + 1] = ay;
          }
          // else: keep as-is (rare)
        }
      }

      // Recompute triangulation with new coordinates (no allocations)
      delaunay.update();
    }

    // 4) Return centers as Point[] (materialize from flat array)
    const centers: Point[] = [];
    const flat = delaunay.points;
    for (let i = 0; i < flat.length; i += 2) {
      centers.push({ x: flat[i], y: flat[i + 1] });
    }

    return { centers, delaunay };
  }

  public genPointsForRegion(
    settings: MapSettings,
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

  // -------- internals --------

  private initPoints(resolution: number, jitter: number): Point[] {
    const pts: Point[] = [];
    for (let x = 0; x < resolution; x++) {
      for (let y = 0; y < resolution; y++) {
        const jx = x + jitter * (this.rng() - this.rng());
        const jy = y + jitter * (this.rng() - this.rng());
        pts.push({ x: jx, y: jy });
      }
    }
    return pts;
  }

  // Shoelace centroid for Array<[x,y]>
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
    if (Math.abs(A) < 1e-12) return verts[0]; // degenerate fallback
    const area = A / 2;
    return [cx / (6 * area), cy / (6 * area)];
  }

  // Use neighbors(i) to compute average neighbor coordinate from the flat points array
  private averageNeighborXY(
    delaunay: DelaunayT<any>,
    i: number
  ): [number, number, number] {
    const flat = delaunay.points;
    let sx = 0,
      sy = 0,
      count = 0;
    for (const j of delaunay.neighbors(i)) {
      sx += flat[2 * j];
      sy += flat[2 * j + 1];
      count++;
    }
    return count
      ? [sx / count, sy / count, count]
      : [flat[2 * i], flat[2 * i + 1], 0];
  }
}
