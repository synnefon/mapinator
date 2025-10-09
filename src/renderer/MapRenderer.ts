import type { Delaunay } from "d3-delaunay";
import type { WorldMap } from "../common/map";
import type { MapSettings } from "../common/settings";
import { BiomeEngine } from "./BiomeColor";

type BBox = { minX: number; minY: number; maxX: number; maxY: number };
type CellGeom = { path: Path2D; bbox: BBox };
type ColorBucket = Map<string, Path2D>; // fillStyle -> combined path

type VoronoiCache = {
  // cache is keyed by the Delaunay object identity + a version (if provided)
  delaunay: Delaunay<any>;
  version: number | undefined;
  bounds: [number, number, number, number]; // [x0, y0, x1, y1] used to clip voronoi
  cells: CellGeom[]; // index-aligned with sites
};

export class MapRenderer {
  // one cache per Delaunay instance
  private geomCache = new WeakMap<Delaunay<any>, VoronoiCache>();

  // Build or fetch the cached Path2D + bbox per cell
  private getVoronoiCache(map: WorldMap): VoronoiCache {
    const pad = map.resolution * 0.1;
    const bounds: [number, number, number, number] = [
      -pad,
      -pad,
      map.resolution + pad,
      map.resolution + pad,
    ];

    const cached = this.geomCache.get(map.delaunay);
    const wantedVersion = (map as any).meshVersion as number | undefined;

    const sameBounds =
      cached &&
      cached.bounds[0] === bounds[0] &&
      cached.bounds[1] === bounds[1] &&
      cached.bounds[2] === bounds[2] &&
      cached.bounds[3] === bounds[3];

    // Rebuild if:
    // - no cache yet
    // - bounds changed
    // - caller bumped meshVersion
    if (!cached || !sameBounds || cached.version !== wantedVersion) {
      const vor = map.delaunay.voronoi(bounds);

      const cells: CellGeom[] = new Array(map.points.length);
      for (let i = 0; i < map.points.length; i++) {
        const poly = vor.cellPolygon(i); // Array<[x, y]> | null
        // Closed & clipped by bounds; still guard just in case:
        if (!poly || poly.length < 3) {
          // Fallback: tiny circle at site (rare)
          const p = map.points[i];
          const path = new Path2D();
          path.arc(p.x, p.y, 0.001, 0, Math.PI * 2);
          cells[i] = {
            path,
            bbox: { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y },
          };
          continue;
        }

        // Build Path2D once
        const path = new Path2D();
        path.moveTo(poly[0][0], poly[0][1]);
        let minX = poly[0][0],
          maxX = poly[0][0];
        let minY = poly[0][1],
          maxY = poly[0][1];

        for (let k = 1; k < poly.length; k++) {
          const x = poly[k][0],
            y = poly[k][1];
          path.lineTo(x, y);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        path.closePath();
        cells[i] = { path, bbox: { minX, minY, maxX, maxY } };
      }

      const fresh: VoronoiCache = {
        delaunay: map.delaunay,
        version: wantedVersion,
        bounds,
        cells,
      };
      this.geomCache.set(map.delaunay, fresh);
      return fresh;
    }

    return cached;
  }

  // Simple bbox-rectangle intersection
  private bboxIntersects(
    b: BBox,
    rx0: number,
    ry0: number,
    rx1: number,
    ry1: number
  ): boolean {
    return !(b.maxX < rx0 || b.minX > rx1 || b.maxY < ry0 || b.minY > ry1);
  }

  // Neighbor-walk to collect only cells intersecting the current view rect
  private collectVisibleCells(
    map: WorldMap,
    cache: VoronoiCache,
    viewRect: { x0: number; y0: number; x1: number; y1: number }
  ): number[] {
    const { x0, y0, x1, y1 } = viewRect;

    // Start from the site nearest to the viewport center
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let seed = map.delaunay.find(cx, cy);
    if (seed == null || seed < 0 || seed >= map.points.length) {
      // Fallback: find nearest to any corner
      seed =
        map.delaunay.find(x0, y0) ??
        map.delaunay.find(x1, y0) ??
        map.delaunay.find(x0, y1) ??
        map.delaunay.find(x1, y1) ??
        0;
    }

    const cells = cache.cells;
    const vis: number[] = [];
    const visited = new Uint8Array(map.points.length);
    const queue = [seed];
    visited[seed] = 1;

    while (queue.length) {
      const i = queue.pop()!;
      // If this cell touches the view rect, render it and enqueue neighbors
      if (this.bboxIntersects(cells[i].bbox, x0, y0, x1, y1)) {
        vis.push(i);
        for (const j of map.delaunay.neighbors(i)) {
          if (!visited[j]) {
            visited[j] = 1;
            // Optional quick-reject: check neighbor site is roughly near the rect
            // to reduce queue growth when panning far away:
            const p = map.points[j];
            if (
              p.x >= x0 - map.resolution * 0.1 &&
              p.x <= x1 + map.resolution * 0.1 &&
              p.y >= y0 - map.resolution * 0.1 &&
              p.y <= y1 + map.resolution * 0.1
            ) {
              queue.push(j);
            }
          }
        }
      }
    }
    return vis;
  }

  public drawCellColors(
    canvas: HTMLCanvasElement,
    map: WorldMap,
    settings: MapSettings,
    panX = 0,
    panY = 0,
    viewScale = 1.0
  ): void {
    const engine = new BiomeEngine(settings.rainfall, settings.seaLevel);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { resolution, elevations, moistures } = map;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // SCALE then TRANSLATE so pan is in pixels
    const scale = (canvas.width / resolution) * viewScale;
    ctx.scale(scale, scale);
    ctx.translate(panX / scale, panY / scale);

    // Map-space viewport rect (+small margin)
    const margin = resolution * 0.05;
    const x0 = Math.max(-resolution, -panX / scale - margin);
    const y0 = Math.max(-resolution, -panY / scale - margin);
    const x1 = Math.min(2 * resolution, (canvas.width - panX) / scale + margin);
    const y1 = Math.min(
      2 * resolution,
      (canvas.height - panY) / scale + margin
    );

    const cache = this.getVoronoiCache(map);
    const visible = this.collectVisibleCells(map, cache, { x0, y0, x1, y1 });

    // ---- Batch by color: single path per color ----
    const buckets: ColorBucket = new Map();

    for (let idx = 0; idx < visible.length; idx++) {
      const i = visible[idx];
      const fill = engine.colorAt(
        settings.theme,
        elevations[i],
        moistures[i]
      );

      let bucket = buckets.get(fill);
      if (!bucket) {
        bucket = new Path2D();
        buckets.set(fill, bucket);
      }
      // Append the cached cell path into the color's combined path
      bucket.addPath(cache.cells[i].path);
    }

    // Hairline stroke in screen space to hide seams (no per-cell transforms needed)
    // 1 device px in map coordinates:
    const hairline = 1 / scale;

    // Draw per color: fill once, stroke once
    for (const [fill, path] of buckets) {
      ctx.fillStyle = fill;
      ctx.fill(path);

      // Stroke with same color to cover antialias cracks between polygons
      ctx.strokeStyle = fill;
      ctx.lineWidth = hairline;
      ctx.stroke(path);
    }

    ctx.restore();
  }
}
