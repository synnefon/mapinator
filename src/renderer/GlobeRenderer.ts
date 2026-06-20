import type { GlobeMap, Vec3 } from "../common/map";
import { hexToHsl, hslToHex } from "../common/colorUtils";
import type { Quat } from "../common/rotation";
import { LOD, type MapSettings } from "../common/settings";
import { clamp } from "../common/util";
import { computeCellColors } from "./BiomeColor";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
// Zoom mapping dials live in settings.ts (LOD); aliased here for the radius math below.
const FIT_FACTOR = LOD.GLOBE_FIT_FRACTION; // globe radius as a fraction of min(canvas w, h) at zoom=0 (whole globe)
const GLOBE_MAX_ZOOM = LOD.MAX_ZOOM_SCALE; // radius multiplier at zoom=1 (deepest zoom; spread over the LOD levels)
const AMBIENT = 0.4; // limb-darkening floor; lower = more dramatic terminator
const SHADE_BUCKETS = 32; // quantize shade for the lightness cache
const HAIRLINE_PX = 1; // stroke each cell in its own color to close seams
// On-screen cell radius (px) below which we stroke each color group to hide the
// ~1px AA seams between cells; above it cells are big enough to skip that pass.
const SEAM_STROKE_MAX_CELL_PX = 10;

/** Apparent globe radius in px for a zoom. zoom=0 fits the canvas; higher zooms in. */
export function globeRadiusPx(canvas: HTMLCanvasElement, zoom: number): number {
  // Geometric (not linear) zoom: equal zoom steps give equal radius RATIOS, so the
  // wheel feels uniform across the range instead of lurching near the whole-globe
  // view. Endpoints: zoom=0 → ×1 (whole globe), zoom=1 → ×GLOBE_MAX_ZOOM (deepest).
  return (
    Math.min(canvas.width, canvas.height) *
    FIT_FACTOR *
    Math.pow(GLOBE_MAX_ZOOM, zoom)
  );
}

// Per-cell base color index into a small palette, cached until theme/sea level or
// the map changes. Grouping the draw by (palette index, shade bucket) is what lets
// us fill each distinct color once instead of once per cell.
type ColorCache = {
  key: string;
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
  // Per-map color cache: the global base and an overlaid patch are both drawn every
  // frame, so a single slot would thrash (each call recomputes the other's colors).
  // A WeakMap keyed by map lets both coexist and frees automatically with the map.
  private colorCache = new WeakMap<GlobeMap, ColorCache>();
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
    const radius = globeRadiusPx(canvas, settings.zoom);

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
    // Conservative on-screen radius of any cell: a cell whose projected site is
    // farther than this outside the canvas has its whole ring off-canvas too.
    const cullR = map.maxRingRadius * radius;

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

      // Project the site and reject the cell if its bounding circle is off-canvas,
      // BEFORE rotating/projecting every ring vertex (the costly part).
      const rsx = sx + qw * stx + (qy * stz - qz * sty);
      const rsy = sy + qw * sty + (qz * stx - qx * stz);
      const psx = cxPx + rsx * radius;
      const psy = cyPx - rsy * radius;
      if (psx < -cullR || psx > W + cullR || psy < -cullR || psy > H + cullR) {
        continue;
      }

      const bucket = Math.round(
        clamp(AMBIENT + (1 - AMBIENT) * rsz, 0, 1) * SHADE_BUCKETS
      );
      const gkey = colorIdx[i] * (SHADE_BUCKETS + 1) + bucket;
      let path = groups.get(gkey);
      if (!path) {
        path = new Path2D();
        groups.set(gkey, path);
      }

      const start = ringOffsets[i];
      const end = ringOffsets[i + 1];
      for (let k = start; k < end; k++) {
        const b = 3 * k;
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
        if (k === start) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
      path.closePath();
    }

    // Fill each distinct color once. When cells are small on screen, also stroke
    // (same color) to close the ~1px AA seams between them; when they're large the
    // seam is hidden and that second pass is skipped.
    const strokeSeams = cullR < SEAM_STROKE_MAX_CELL_PX;
    for (const [gkey, path] of groups) {
      const paletteIdx = (gkey / (SHADE_BUCKETS + 1)) | 0;
      const bucket = gkey - paletteIdx * (SHADE_BUCKETS + 1);
      const fill = this.shade(palette[paletteIdx], bucket);
      ctx.fillStyle = fill;
      ctx.fill(path);
      if (strokeSeams) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = HAIRLINE_PX;
        ctx.stroke(path);
      }
    }
  }

  /**
   * Per-cell base color, stored as an index into a small deduplicated palette.
   * Cached until the theme/sea level or the map changes.
   */
  private getColors(map: GlobeMap, settings: MapSettings): ColorCache {
    const key = `${settings.theme}|${settings.seaLevel}`;
    const cached = this.colorCache.get(map);
    if (cached && cached.key === key) return cached;

    const { palette, colorIdx } = computeCellColors(
      map,
      settings.theme,
      settings.seaLevel
    );
    const entry: ColorCache = { key, palette, colorIdx };
    this.colorCache.set(map, entry);
    return entry;
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
