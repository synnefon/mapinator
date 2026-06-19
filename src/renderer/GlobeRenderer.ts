import type { GlobeMap } from "../common/map";
import { hexToHsl, hslToHex } from "../common/colorUtils";
import { ELEVATION_CONTRAST, type MapSettings } from "../common/settings";
import { applyContrast, clamp, lerp } from "../common/util";
import { colorAt } from "./BiomeColor";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */
const FIT_FACTOR = 0.46; // globe radius as a fraction of min(canvas w, h) when scale=1
const GLOBE_MAX_ZOOM = 4; // radius multiplier at scale=0 (zoomed all the way in)
const AMBIENT = 0.4; // limb-darkening floor; lower = more dramatic terminator
const SHADE_BUCKETS = 32; // quantize shade for the lightness cache
const HAIRLINE_PX = 1; // stroke each cell in its own color to close seams
const ICE_COLOR = "#eef6fb"; // pale icy white for polar-cap cells
const ICE_THRESHOLD = 0.5; // a cell is ice past this mask value (crisp, cell-resolution edge)

export type GlobeOrientation = { yaw: number; pitch: number };

/** Apparent globe radius in px for a zoom. scale=1 fits the canvas; lower zooms in. */
export function globeRadiusPx(canvas: HTMLCanvasElement, scale: number): number {
  return (
    Math.min(canvas.width, canvas.height) *
    FIT_FACTOR *
    lerp(GLOBE_MAX_ZOOM, 1, scale)
  );
}

type ColorCache = { key: string; map: GlobeMap; colors: string[] };

/**
 * Draws a GlobeMap as a 3D ball via orthographic projection: rotate each cell by
 * the view orientation, cull the back hemisphere, project to screen, fill by biome
 * color with simple limb darkening. Rotation/zoom only re-project — no regen.
 */
export class GlobeRenderer {
  private colorCache: ColorCache | null = null;
  private shadeCache = new Map<string, string>();

  public draw(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    settings: MapSettings,
    orientation: GlobeOrientation
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width: W, height: H } = canvas;
    ctx.clearRect(0, 0, W, H);

    const cxPx = W / 2;
    const cyPx = H / 2;
    const radius = globeRadiusPx(canvas, settings.scale);

    // Rotate a unit vector by yaw (about Y) then pitch (about X); camera looks
    // down +Z, so a point is on the near (visible) hemisphere when rotated z > 0.
    const { yaw, pitch } = orientation;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const rotZ = (x: number, y: number, z: number) => {
      const z1 = -sinYaw * x + cosYaw * z;
      return sinPitch * y + cosPitch * z1;
    };

    const colors = this.getColors(map, settings);

    for (let i = 0; i < map.cells.length; i++) {
      const cell = map.cells[i];
      const sz = rotZ(cell.site.x, cell.site.y, cell.site.z);
      if (sz <= 0) continue; // back hemisphere — skip

      const ring = cell.ring;
      const path = new Path2D();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let k = 0; k < ring.length; k++) {
        const v = ring[k];
        const rx = cosYaw * v.x + sinYaw * v.z;
        const rz = -sinYaw * v.x + cosYaw * v.z;
        const ry = cosPitch * v.y - sinPitch * rz;
        const px = cxPx + rx * radius;
        const py = cyPx - ry * radius;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (k === 0) path.moveTo(px, py);
        else path.lineTo(px, py);
      }
      // Off-canvas (e.g. when zoomed in) → skip the costly fill/stroke.
      if (maxX < 0 || minX > W || maxY < 0 || minY > H) continue;
      path.closePath();

      const fill = this.shade(colors[i], AMBIENT + (1 - AMBIENT) * sz);
      ctx.fillStyle = fill;
      ctx.fill(path);
      ctx.strokeStyle = fill;
      ctx.lineWidth = HAIRLINE_PX;
      ctx.stroke(path);
    }
  }

  /** Per-cell biome colors; cached until theme/sea level or the map changes. */
  private getColors(map: GlobeMap, settings: MapSettings): string[] {
    const key = `${settings.theme}|${settings.seaLevel}`;
    if (
      this.colorCache &&
      this.colorCache.map === map &&
      this.colorCache.key === key
    ) {
      return this.colorCache.colors;
    }

    const colors = new Array<string>(map.cells.length);
    for (let i = 0; i < map.cells.length; i++) {
      const cell = map.cells[i];
      // Crisp, cell-resolution ice (like the land cells), not a smooth blend.
      if (cell.ice > ICE_THRESHOLD) {
        colors[i] = ICE_COLOR;
        continue;
      }
      colors[i] = colorAt(
        settings.theme,
        applyContrast(cell.elevation, ELEVATION_CONTRAST),
        cell.moisture,
        map.rainfall,
        settings.seaLevel
      );
    }

    this.colorCache = { key, map, colors };
    return colors;
  }

  /** Multiply a color's lightness by `factor` (quantized + cached for speed). */
  private shade(hex: string, factor: number): string {
    const bucket = Math.round(clamp(factor, 0, 1) * SHADE_BUCKETS);
    const cacheKey = `${hex}|${bucket}`;
    const cached = this.shadeCache.get(cacheKey);
    if (cached) return cached;
    const { h, s, l } = hexToHsl(hex);
    const out = hslToHex(h, s, clamp((l * bucket) / SHADE_BUCKETS, 0, 1));
    this.shadeCache.set(cacheKey, out);
    return out;
  }
}
