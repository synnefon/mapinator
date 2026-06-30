import type { Vec3 } from "../common/3DMath";
import type { Projector } from "./projection";

/** The minimal label shape this draws — satisfied by MapFeature (seas, continents…) AND river labels. */
export type LabelItem = { name: string; anchor: Vec3; extent: number; minLevel: number; cellCount: number };

// A "geographic labels" annotation drawn on a 2D overlay canvas layered over the globe (the WebGL map
// canvas can't share a 2D context) — same pattern as plateArrows. Anchors are projected each frame;
// the feature set itself is computed once per (map, sea level, language) on the main thread.
const FONT_FRAC = 0.5; // font px as a fraction of the feature's on-screen radius
const MIN_FONT_PX = 11;
const MAX_FONT_PX = 34;
const ZOOM_OUT_SCALE = 0.45; // at the whole-globe view, labels shrink to this fraction of full size…
const ZOOM_FULL = 0.5; // …ramping back to full size by this zoom (orbit zoom: 0 = whole globe, 1 = deepest)
// Drawn twice for contrast over any terrain: a dark casing, then a light core (cf. plateArrows).
const CASING = "rgba(20,20,20,0.85)";
const CORE = "rgba(255,255,255,0.96)";

/** Per-frame zoom scale: labels shrink on the whole-globe view, full size once zoomed past ZOOM_FULL. */
export const labelZoomScale = (zoom: number): number =>
  ZOOM_OUT_SCALE + (1 - ZOOM_OUT_SCALE) * Math.min(1, zoom / ZOOM_FULL);

/** A feature label's on-screen font px (feature size → font, clamped, then the zoom scale). Exported so
 *  the declutter pass sizes a label's box exactly as it'll be drawn. */
export const featureFontPx = (extent: number, proj: Projector): number =>
  Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, extent * proj.radius * FONT_FRAC) * labelZoomScale(proj.zoom));

/**
 * Draw feature name labels onto the 2D overlay, projected to match the globe (orthographic, same
 * apparent radius + horizontal offset as the active renderer). EVERY feature whose reveal tier the
 * current zoom level has reached is labelled — no overlap or on-screen-size culling — so all eligible
 * lakes, islands, seas, and oceans get a name. Clears first, so an empty list wipes it.
 */
export function drawFeatureLabels(
  canvas: HTMLCanvasElement,
  features: LabelItem[],
  proj: Projector,
  level: number, // LOD zoom level — a feature shows only once it reaches its minLevel tier
  shown?: ReadonlySet<string> // declutter decision (by name); when given, only these labels are drawn
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (features.length === 0) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // Draw biggest LAST so where labels still touch the major feature sits on top; the declutter pass
  // (shown) has already dropped the overlaps, so this is mostly a tie-break on near-misses.
  const order = features
    .filter((f) => f.minLevel <= level && (!shown || shown.has(f.name)))
    .sort((a, b) => a.cellCount - b.cellCount);

  for (const f of order) {
    const r = proj.project(f.anchor);
    if (!r.front) continue; // back hemisphere / right at the limb

    const fontPx = featureFontPx(f.extent, proj);
    ctx.font = `bold ${fontPx}px 'Roboto Mono', ui-monospace, monospace`;

    ctx.lineWidth = Math.max(2, fontPx * 0.18);
    ctx.strokeStyle = CASING;
    ctx.strokeText(f.name, r.x, r.y);
    ctx.fillStyle = CORE;
    ctx.fillText(f.name, r.x, r.y);
  }
}
