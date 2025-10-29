import type { Delaunay } from "d3-delaunay";
import { quantizeColor } from "../common/colorUtils";
import type { WorldMap } from "../common/map";
import type { MapSettings } from "../common/settings";
import { colorAt } from "./BiomeColor";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
const DEGENERATE_RADIUS = 0.001;
const ARC_FULL_CIRCLE = Math.PI * 2;
const VORONOI_PAD_FACTOR = 0.1;
const VIEW_MARGIN_FACTOR = 0.05;
const HAIRLINE_PX = 1;
const MIN_POLYGON_VERTICES = 3;

type ColorBucket = Map<string, Path2D>; // fillStyle -> combined path

type VoronoiCache = {
  delaunay: Delaunay<any>;
  version: number | undefined;
  bounds: [number, number, number, number];
  cells: Path2D[];
  bboxData: Float32Array;
};

type ColorCache = {
  version: number | undefined;
  themeHash: string;
  colors: string[];
};

export class MapRenderer {
  private geomCache = new WeakMap<Delaunay<any>, VoronoiCache>();
  private cellColorCache = new WeakMap<WorldMap, ColorCache>();
  private colorQuantCache = new Map<string, string>();
  private buckets: ColorBucket = new Map();

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

  private createDegenerateCell(
    point: { x: number; y: number },
    cellIdx: number,
    bboxData: Float32Array
  ): Path2D {
    const path = new Path2D();
    path.arc(point.x, point.y, DEGENERATE_RADIUS, 0, ARC_FULL_CIRCLE);
    this.writeBbox(bboxData, cellIdx, point.x, point.y, point.x, point.y);
    return path;
  }

  private buildCellGeometry(
    i: number,
    vor: any,
    fallbackPoint: { x: number; y: number },
    bboxData: Float32Array
  ): Path2D {
    const { circumcenters } = vor;
    const { halfedges, triangles, inedges } = vor.delaunay;

    const e0 = inedges[i];
    if (e0 === -1) return this.createDegenerateCell(fallbackPoint, i, bboxData);

    const path = new Path2D();
    let e = e0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let first = true;

    do {
      const t = Math.floor(e / 3);
      const cx = circumcenters[2 * t];
      const cy = circumcenters[2 * t + 1];

      if (first) {
        path.moveTo(cx, cy);
        first = false;
      } else {
        path.lineTo(cx, cy);
      }

      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;

      e = e % 3 === 2 ? e - 2 : e + 1;
      if (triangles[e] !== i) break;
      e = halfedges[e];
      if (e === -1) {
        return this.buildCellGeometryFallback(i, vor, fallbackPoint, bboxData);
      }
    } while (e !== e0 && e !== -1);

    path.closePath();
    this.writeBbox(bboxData, i, minX, minY, maxX, maxY);
    return path;
  }

  private buildCellGeometryFallback(
    i: number,
    vor: any,
    fallbackPoint: { x: number; y: number },
    bboxData: Float32Array
  ): Path2D {
    const poly = vor.cellPolygon(i);
    if (!poly || poly.length < MIN_POLYGON_VERTICES) {
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

    const colors = new Array<string>(map.points.length);
    for (let i = 0; i < map.points.length; i++) {
      const rawColor = colorAt(
        settings.theme,
        map.elevations[i],
        map.moistures[i],
        settings.rainfall,
        settings.seaLevel
      );
      colors[i] = this.quantizeColorCached(rawColor);
    }

    this.cellColorCache.set(map, { version: wantedVersion, themeHash, colors });
    return colors;
  }

  private quantizeColorCached(color: string): string {
    const cached = this.colorQuantCache.get(color);
    if (cached) return cached;
    const result = quantizeColor(color);
    this.colorQuantCache.set(color, result);
    return result;
  }

  private getVoronoiCache(map: WorldMap): VoronoiCache {
    const pad = map.resolution * VORONOI_PAD_FACTOR;
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

    const vor = map.delaunay.voronoi(bounds);
    const numCells = map.points.length;
    const cells = new Array<Path2D>(numCells);
    const bboxData = new Float32Array(numCells * 4);

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

  private collectVisibleCells(
    map: WorldMap,
    cache: VoronoiCache,
    viewRect: { x0: number; y0: number; x1: number; y1: number }
  ): number[] {
    const { x0, y0, x1, y1 } = viewRect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    let seed = map.delaunay.find(cx, cy);

    if (seed == null || seed < 0 || seed >= map.points.length) {
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
      if (!this.bboxIntersects(bboxData, i, x0, y0, x1, y1)) continue;

      vis.push(i);
      for (const j of map.delaunay.neighbors(i)) {
        if (visited[j]) continue;
        visited[j] = 1;

        const p = map.points[j];
        const pad = map.resolution * VORONOI_PAD_FACTOR;
        const nearX = p.x >= x0 - pad && p.x <= x1 + pad;
        const nearY = p.y >= y0 - pad && p.y <= y1 + pad;
        if (nearX && nearY) queue.push(j);
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

    const scale = (canvas.width / resolution) * viewScale;
    ctx.scale(scale, scale);
    ctx.translate(panX / scale, panY / scale);

    const margin = resolution * VIEW_MARGIN_FACTOR;
    const x0 = Math.max(-resolution, -panX / scale - margin);
    const y0 = Math.max(-resolution, -panY / scale - margin);
    const x1 = Math.min(2 * resolution, (canvas.width - panX) / scale + margin);
    const y1 = Math.min(
      2 * resolution,
      (canvas.height - panY) / scale + margin
    );

    const cache = this.getVoronoiCache(map);
    const visible = this.collectVisibleCells(map, cache, { x0, y0, x1, y1 });
    const colors = this.getCellColors(map, settings);

    this.buckets.clear();
    for (let idx = 0; idx < visible.length; idx++) {
      const i = visible[idx];
      const fill = colors[i];
      let bucket = this.buckets.get(fill);
      if (!bucket) {
        bucket = new Path2D();
        this.buckets.set(fill, bucket);
      }
      bucket.addPath(cache.cells[i]);
    }

    const hairline = HAIRLINE_PX / scale;
    for (const [fill, path] of this.buckets) {
      ctx.fillStyle = fill;
      ctx.fill(path);
      ctx.strokeStyle = fill;
      ctx.lineWidth = hairline;
      ctx.stroke(path);
    }

    ctx.restore();
  }
}
