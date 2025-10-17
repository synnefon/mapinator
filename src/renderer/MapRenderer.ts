import type { Delaunay } from "d3-delaunay";
import type { WorldMap } from "../common/map";
import type { MapSettings } from "../common/settings";
import { colorAt } from "./BiomeColor";

type ColorBucket = Map<string, Path2D>; // fillStyle -> combined path

type VoronoiCache = {
  // cache is keyed by the Delaunay object identity + a version (if provided)
  delaunay: Delaunay<any>;
  version: number | undefined;
  bounds: [number, number, number, number]; // [x0, y0, x1, y1] used to clip voronoi
  cells: Path2D[]; // index-aligned with sites
  bboxData: Float32Array; // [minX, minY, maxX, maxY] * numCells for fast bbox checks
};

type ColorCache = {
  version: number | undefined;
  themeHash: string; // track theme/rainfall/seaLevel changes
  colors: string[]; // index-aligned with cells, pre-quantized
};

export class MapRenderer {
  // one cache per Delaunay instance
  private geomCache = new WeakMap<Delaunay<any>, VoronoiCache>();

  // Pre-computed quantized colors per map
  private cellColorCache = new WeakMap<WorldMap, ColorCache>();

  // Raw color -> quantized color lookup
  private colorQuantCache = new Map<string, string>();

  // Reusable bucket map to avoid allocations per frame
  private buckets: ColorBucket = new Map();

  // Helper: Write bbox to typed array at cell index
  private writeBbox(
    bboxData: Float32Array,
    cellIdx: number,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
  ): void {
    const idx = cellIdx * 4;
    bboxData[idx] = minX;
    bboxData[idx + 1] = minY;
    bboxData[idx + 2] = maxX;
    bboxData[idx + 3] = maxY;
  }

  // Helper: Create degenerate cell (tiny circle at point)
  private createDegenerateCell(
    point: { x: number; y: number },
    cellIdx: number,
    bboxData: Float32Array
  ): Path2D {
    const path = new Path2D();
    path.arc(point.x, point.y, 0.001, 0, Math.PI * 2);
    this.writeBbox(bboxData, cellIdx, point.x, point.y, point.x, point.y);
    return path;
  }

  // Fast cell building using direct halfedge access
  // Avoids cellPolygon() overhead and intermediate array allocations
  private buildCellGeometry(
    i: number,
    vor: any, // Voronoi from d3-delaunay
    fallbackPoint: { x: number; y: number },
    bboxData: Float32Array // Write bbox to [i*4 ... i*4+3]
  ): Path2D {
    // Access d3-delaunay internals for performance
    const { circumcenters } = vor;
    const { halfedges, triangles, inedges } = vor.delaunay;

    // Start from an incoming halfedge for this site
    const e0 = inedges[i];
    if (e0 === -1) return this.createDegenerateCell(fallbackPoint, i, bboxData);

    const path = new Path2D();
    let e = e0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let first = true;

    // Walk the halfedges around this site
    do {
      const t = Math.floor(e / 3); // triangle index
      const cx = circumcenters[2 * t];
      const cy = circumcenters[2 * t + 1];

      if (first) {
        path.moveTo(cx, cy);
        first = false;
      } else {
        path.lineTo(cx, cy);
      }

      // Update bbox
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      e = e % 3 === 2 ? e - 2 : e + 1; // next halfedge in triangle
      if (triangles[e] !== i) break; // wrong site, shouldn't happen
      e = halfedges[e]; // opposite halfedge
      if (e === -1) {
        // Hit boundary, need to handle clipping
        return this.buildCellGeometryFallback(i, vor, fallbackPoint, bboxData);
      }
    } while (e !== e0 && e !== -1);

    path.closePath();
    this.writeBbox(bboxData, i, minX, minY, maxX, maxY);
    return path;
  }

  // Fallback for boundary cells that need clipping
  private buildCellGeometryFallback(
    i: number,
    vor: any,
    fallbackPoint: { x: number; y: number },
    bboxData: Float32Array
  ): Path2D {
    const poly = vor.cellPolygon(i);
    if (!poly || poly.length < 3) {
      return this.createDegenerateCell(fallbackPoint, i, bboxData);
    }

    const path = new Path2D();
    path.moveTo(poly[0][0], poly[0][1]);
    let [minX, maxX] = [poly[0][0], poly[0][0]];
    let [minY, maxY] = [poly[0][1], poly[0][1]];

    for (let k = 1; k < poly.length; k++) {
      const [x, y] = poly[k];
      path.lineTo(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    path.closePath();
    this.writeBbox(bboxData, i, minX, minY, maxX, maxY);
    return path;
  }

  // Color quantization: reduce color precision for better batching
  // 5 bits per channel = 32 levels = 32^3 = 32,768 possible colors (vs 16.7M)
  private quantizeColor(color: string): string {
    const cached = this.colorQuantCache.get(color);
    if (cached) return cached;

    const bits = 5; // bits per channel (5 = good balance of quality vs batching)
    const levels = (1 << bits) - 1; // 31 for 5 bits
    const scale = 255 / levels;

    // Parse hex color #RRGGBB
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);

    // Quantize each channel
    const qr = Math.round(r / scale) * scale;
    const qg = Math.round(g / scale) * scale;
    const qb = Math.round(b / scale) * scale;

    // Convert back to hex
    const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
    const result = `#${toHex(qr)}${toHex(qg)}${toHex(qb)}`;

    this.colorQuantCache.set(color, result);
    return result;
  }

  // Pre-compute and cache quantized colors for all cells
  private getCellColors(map: WorldMap, settings: MapSettings): string[] {
    const wantedVersion = (map as any).meshVersion as number | undefined;
    const themeHash = `${settings.theme}:${settings.rainfall}:${settings.seaLevel}`;

    const cached = this.cellColorCache.get(map);
    const cacheHit =
      cached &&
      cached.version === wantedVersion &&
      cached.themeHash === themeHash;

    if (cacheHit) {
      return cached.colors;
    }

    // Compute colors for all cells once
    const colors = new Array<string>(map.points.length);
    for (let i = 0; i < map.points.length; i++) {
      const rawColor = colorAt(
        settings.theme,
        map.elevations[i],
        map.moistures[i],
        settings.rainfall,
        settings.seaLevel
      );
      colors[i] = this.quantizeColor(rawColor);
    }

    this.cellColorCache.set(map, {
      version: wantedVersion,
      themeHash,
      colors,
    });

    return colors;
  }

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
    const meshVersion = (map as any).meshVersion as number | undefined;

    const cacheValid =
      cached &&
      cached.version === meshVersion &&
      cached.bounds.length === bounds.length &&
      cached.bounds.every((v, i) => v === bounds[i]);

    if (cacheValid) return cached;

    // Build fresh voronoi + cell paths/bboxes
    const vor = map.delaunay.voronoi(bounds);
    // Pre-allocate arrays (batch allocation)
    const numCells = map.points.length;
    const cells = new Array<Path2D>(numCells);
    const bboxData = new Float32Array(numCells * 4); // 4 floats per cell

    // Build cells using regular for loop (faster than .map())
    for (let i = 0; i < numCells; i++) {
      cells[i] = this.buildCellGeometry(i, vor, map.points[i], bboxData);
    }

    const fresh: VoronoiCache = {
      delaunay: map.delaunay,
      version: meshVersion,
      bounds,
      cells,
      bboxData,
    };

    this.geomCache.set(map.delaunay, fresh);

    return fresh;
  }

  // Simple bbox-rectangle intersection (reads from typed array)
  private bboxIntersects(
    bboxData: Float32Array,
    cellIdx: number,
    rx0: number,
    ry0: number,
    rx1: number,
    ry1: number
  ): boolean {
    const idx = cellIdx * 4;
    const minX = bboxData[idx];
    const minY = bboxData[idx + 1];
    const maxX = bboxData[idx + 2];
    const maxY = bboxData[idx + 3];
    return !(maxX < rx0 || minX > rx1 || maxY < ry0 || minY > ry1);
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

    const bboxData = cache.bboxData;
    const vis: number[] = [];
    const visited = new Uint8Array(map.points.length);
    const queue = [seed];
    visited[seed] = 1;

    while (queue.length) {
      const i = queue.pop()!;
      // If this cell touches the view rect, render it and enqueue neighbors
      if (this.bboxIntersects(bboxData, i, x0, y0, x1, y1)) {
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { resolution } = map;

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

    // Get pre-computed colors (computed once per map/settings change)
    const colors = this.getCellColors(map, settings);

    // ---- Batch by color: single path per color ----
    // Reuse buckets map to avoid allocation per frame
    this.buckets.clear();

    for (let idx = 0; idx < visible.length; idx++) {
      const i = visible[idx];
      const fill = colors[i];

      let bucket = this.buckets.get(fill);
      if (!bucket) {
        bucket = new Path2D();
        this.buckets.set(fill, bucket);
      }
      // Append the cached cell path into the color's combined path
      bucket.addPath(cache.cells[i]);
    }

    // Hairline stroke in screen space to hide seams (no per-cell transforms needed)
    // 1 device px in map coordinates:
    const hairline = 1 / scale;

    // Draw per color: fill once, stroke once
    for (const [fill, path] of this.buckets) {
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
