import { iceColorFor } from "../common/biomes";
import type { GlobeMap, Vec3 } from "../common/map";
import { hexToHsl, hslToHex } from "../common/colorUtils";
import type { Quat } from "../common/rotation";
import { ELEVATION_CONTRAST, type MapSettings } from "../common/settings";
import { applyContrast, clamp, lerp } from "../common/util";
import { colorAt } from "./BiomeColor";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
const FIT_FACTOR = 0.46; // globe radius as a fraction of min(canvas w, h) when scale=1
const GLOBE_MAX_ZOOM = 24; // radius multiplier at scale=0 (deepest zoom; spread over the LOD levels)
const AMBIENT = 0.4; // limb-darkening floor; lower = more dramatic terminator
const SHADE_BUCKETS = 32; // quantize shade for the lightness cache
const HAIRLINE_PX = 1; // stroke each cell in its own color to close seams
const ICE_THRESHOLD = 0.5; // a cell is ice past this mask value (crisp, cell-resolution edge)

/** Apparent globe radius in px for a zoom. scale=1 fits the canvas; lower zooms in. */
export function globeRadiusPx(canvas: HTMLCanvasElement, scale: number): number {
  return (
    Math.min(canvas.width, canvas.height) *
    FIT_FACTOR *
    lerp(GLOBE_MAX_ZOOM, 1, scale)
  );
}

// Per-cell base color index into a small palette, cached until theme/sea level or
// the map changes. Grouping the draw by (palette index, shade bucket) is what lets
// us fill each distinct color once instead of once per cell.
type ColorCache = {
  key: string;
  map: GlobeMap;
  palette: string[];
  colorIdx: Int32Array;
};

/** The spherical cap occluded by an overlaid patch; base cells inside it are skipped. */
type SkipCap = { center: Vec3; cosKeep: number };

/**
 * Draws a GlobeMap as a 3D ball via orthographic projection: rotate each cell by
 * the view orientation, cull the back hemisphere, project to screen, fill by biome
 * color with simple limb darkening. Rotation/zoom only re-project — no regen.
 *
 * Cells are bucketed by final fill color and each bucket is filled once (a single
 * Path2D with many subpaths), so a full-globe draw issues a few hundred canvas
 * ops instead of one fill+stroke per cell.
 */
export class GlobeRenderer {
  private colorCache: ColorCache | null = null;
  private shadeCache = new Map<string, string>();

  public draw(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    settings: MapSettings,
    orientation: Quat,
    clear = true,
    skipCap?: SkipCap
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: W, height: H } = canvas;
    if (clear) ctx.clearRect(0, 0, W, H); // skip when layering a patch over the base

    const cxPx = W / 2;
    const cyPx = H / 2;
    const radius = globeRadiusPx(canvas, settings.scale);

    const { palette, colorIdx } = this.getColors(map, settings);
    const { sites, ringVerts, ringOffsets, cellCount } = map;

    // Orientation rotates world → view; camera looks down +Z, so a point is on the
    // near (visible) hemisphere when its rotated z > 0. qRotate is inlined here to
    // avoid allocating a Vec3 per site + per ring vertex every frame.
    const qx = orientation.x;
    const qy = orientation.y;
    const qz = orientation.z;
    const qw = orientation.w;

    const hasSkip = skipCap !== undefined;
    const scx = skipCap ? skipCap.center.x : 0;
    const scy = skipCap ? skipCap.center.y : 0;
    const scz = skipCap ? skipCap.center.z : 0;
    const scos = skipCap ? skipCap.cosKeep : 0;

    // One Path2D per distinct (palette index, shade bucket); filled once at the end.
    const groups = new Map<number, Path2D>();
    const xs: number[] = []; // reused projected-ring scratch (one cell at a time)
    const ys: number[] = [];

    for (let i = 0; i < cellCount; i++) {
      const sx = sites[3 * i];
      const sy = sites[3 * i + 1];
      const sz = sites[3 * i + 2];

      // Occlusion cull: this global base cell is hidden under the overlaid patch.
      if (hasSkip && sx * scx + sy * scy + sz * scz >= scos) continue;

      // Rotate the site; its view-space z drives the cull and the limb darkening.
      const stx = 2 * (qy * sz - qz * sy);
      const sty = 2 * (qz * sx - qx * sz);
      const stz = 2 * (qx * sy - qy * sx);
      const rsz = sz + qw * stz + (qx * sty - qy * stx);
      if (rsz <= 0) continue; // back hemisphere — skip

      const start = ringOffsets[i];
      const end = ringOffsets[i + 1];
      const len = end - start;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < len; k++) {
        const b = 3 * (start + k);
        const vx = ringVerts[b];
        const vy = ringVerts[b + 1];
        const vz = ringVerts[b + 2];
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        const rx = vx + qw * tx + (qy * tz - qz * ty);
        const ry = vy + qw * ty + (qz * tx - qx * tz);
        const px = cxPx + rx * radius;
        const py = cyPx - ry * radius;
        xs[k] = px;
        ys[k] = py;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      // Off-canvas (e.g. when zoomed in) → skip the costly path build/fill.
      if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;

      const bucket = Math.round(
        clamp(AMBIENT + (1 - AMBIENT) * rsz, 0, 1) * SHADE_BUCKETS
      );
      const gkey = colorIdx[i] * (SHADE_BUCKETS + 1) + bucket;
      let path = groups.get(gkey);
      if (!path) {
        path = new Path2D();
        groups.set(gkey, path);
      }
      path.moveTo(xs[0], ys[0]);
      for (let k = 1; k < len; k++) path.lineTo(xs[k], ys[k]);
      path.closePath();
    }

    // One fill + one stroke per distinct color. The hairline stroke (same color)
    // closes the sub-pixel seams between adjacent cells.
    for (const [gkey, path] of groups) {
      const paletteIdx = (gkey / (SHADE_BUCKETS + 1)) | 0;
      const bucket = gkey - paletteIdx * (SHADE_BUCKETS + 1);
      const fill = this.shade(palette[paletteIdx], bucket);
      ctx.fillStyle = fill;
      ctx.fill(path);
      ctx.strokeStyle = fill;
      ctx.lineWidth = HAIRLINE_PX;
      ctx.stroke(path);
    }
  }

  /**
   * Per-cell base color, stored as an index into a small deduplicated palette.
   * Cached until the theme/sea level or the map changes.
   */
  private getColors(map: GlobeMap, settings: MapSettings): ColorCache {
    const key = `${settings.theme}|${settings.seaLevel}`;
    if (
      this.colorCache &&
      this.colorCache.map === map &&
      this.colorCache.key === key
    ) {
      return this.colorCache;
    }

    const iceColor = iceColorFor(settings.theme); // matches this theme's snowiest peak
    const { elevation, moisture, ice, cellCount, rainfall } = map;
    const colorIdx = new Int32Array(cellCount);
    const palette: string[] = [];
    const indexOf = new Map<string, number>();
    const intern = (hex: string): number => {
      let idx = indexOf.get(hex);
      if (idx === undefined) {
        idx = palette.length;
        palette.push(hex);
        indexOf.set(hex, idx);
      }
      return idx;
    };

    for (let i = 0; i < cellCount; i++) {
      // Crisp, cell-resolution ice (like the land cells), not a smooth blend.
      const hex =
        ice[i] > ICE_THRESHOLD
          ? iceColor
          : colorAt(
              settings.theme,
              applyContrast(elevation[i], ELEVATION_CONTRAST),
              moisture[i],
              rainfall,
              settings.seaLevel
            );
      colorIdx[i] = intern(hex);
    }

    this.colorCache = { key, map, palette, colorIdx };
    return this.colorCache;
  }

  /**
   * Multiply a color's lightness by `bucket / SHADE_BUCKETS` (quantized + cached).
   * Now called once per color group, not once per cell.
   */
  private shade(hex: string, bucket: number): string {
    const cacheKey = `${hex}|${bucket}`;
    const cached = this.shadeCache.get(cacheKey);
    if (cached) return cached;
    const { h, s, l } = hexToHsl(hex);
    const out = hslToHex(h, s, clamp((l * bucket) / SHADE_BUCKETS, 0, 1));
    this.shadeCache.set(cacheKey, out);
    return out;
  }
}
