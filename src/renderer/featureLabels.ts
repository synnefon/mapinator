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
  level: number // LOD zoom level — a feature shows only once it reaches its minLevel tier
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (features.length === 0) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  // Smaller labels when zoomed out, full size once zoomed in — a single per-frame scale on top of
  // the per-feature size, so the whole-globe view reads calmer.
  const zoomScale = ZOOM_OUT_SCALE + (1 - ZOOM_OUT_SCALE) * Math.min(1, proj.zoom / ZOOM_FULL);

  // Label every tier-eligible feature (no decluttering). Draw biggest LAST so the major features
  // sit on top where labels collide; the dark casing keeps any overlap legible.
  const order = features
    .filter((f) => f.minLevel <= level)
    .sort((a, b) => a.cellCount - b.cellCount);

  for (const f of order) {
    const r = proj.project(f.anchor);
    if (!r.front) continue; // back hemisphere / right at the limb

    const fontPx = Math.max(
      MIN_FONT_PX,
      Math.min(MAX_FONT_PX, f.extent * proj.radius * FONT_FRAC) * zoomScale
    );
    ctx.font = `bold ${fontPx}px 'Roboto Mono', ui-monospace, monospace`;

    ctx.lineWidth = Math.max(2, fontPx * 0.18);
    ctx.strokeStyle = CASING;
    ctx.strokeText(f.name, r.x, r.y);
    ctx.fillStyle = CORE;
    ctx.fillText(f.name, r.x, r.y);
  }
}
