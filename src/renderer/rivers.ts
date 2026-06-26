import { Quat } from "../common/3DMath";
import { RIVERS } from "../common/settings";
import type { RiverData } from "../mapgen/features/rivers";
import { globeRadiusPx } from "./GlobeRenderer";

// Rivers drawn on a transparent 2D overlay over the globe, like plateArrows/featureLabels (the WebGL
// canvas can't share a 2D context). The network polylines are routed in features/rivers.ts; here we
// only project them — orthographic, matching the active renderer's radius + horizontal offset — cull
// the segments behind the limb, and stroke them blue.
//
// Width tapers with flow (normalized [0,1] per vertex) and grows with zoom (RIVERS.WIDTH_ZOOM_BOOST).
// To keep a dense network cheap on every orbit frame, segments are bucketed by width so the whole
// network strokes in a handful of paths instead of one stroke() per segment.

const MIN_FRONT_Z = 0.04; // cull segments at/behind the visible limb (matches the other overlays)
const BUCKETS = 7; // width quantization — segments in a bucket stroke as one path
const CORE = "rgba(70,135,205,0.92)"; // river blue
const CASING = "rgba(12,40,72,0.5)"; // dark outline for contrast over land/snow
const CASING_EXTRA_PX = 1.3; // casing width = core width + this
const CASING_MIN_PX = 1.2; // skip the casing on hairline rivers (it would swamp them)
const WIDTH_FLOOR_PX = 0.4; // never let a river vanish to nothing

/**
 * Draw the river network onto a 2D overlay canvas, projected to match the globe. `rivers` is the
 * routed polyline soup; clears first, so an empty network just wipes the overlay (rivers off).
 */
export function drawRivers(
  canvas: HTMLCanvasElement,
  rivers: RiverData,
  orientation: Quat,
  zoom: number,
  offsetFraction: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  const { positions, widths, offsets } = rivers;
  if (positions.length === 0) return;

  const radius = globeRadiusPx(canvas, zoom);
  const refRadius = globeRadiusPx(canvas, 0); // zoom-0 radius → rivers thicken with zoom from here
  const zoomScale = Math.pow(radius / refRadius, RIVERS.WIDTH_ZOOM_BOOST.value);
  const wMin = RIVERS.WIDTH_MIN.value;
  const wSpan = RIVERS.WIDTH_MAX.value - wMin;
  const widthPx = (w: number): number => Math.max(WIDTH_FLOOR_PX, (wMin + w * wSpan) * zoomScale);
  // Zoom reveal: hide low-flow tributaries when zoomed out, surface them as you zoom in. Cutoff falls
  // from ZOOM_REVEAL (whole-globe) to 0 (max zoom), so trunks show always and creeks emerge with zoom.
  const revealCutoff = RIVERS.ZOOM_REVEAL.value * (1 - zoom);
  const offX = offsetFraction * W;
  const cx = W / 2;
  const cy = H / 2;

  // Project every vertex once (shared across all segments).
  const n = positions.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const front = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = Quat.rotate(orientation, {
      x: positions[3 * i],
      y: positions[3 * i + 1],
      z: positions[3 * i + 2],
    });
    sx[i] = cx + r.x * radius + offX;
    sy[i] = cy - r.y * radius;
    front[i] = r.z >= MIN_FRONT_Z ? 1 : 0;
  }

  // Bucket each front-facing segment by its (normalized) flow width, one path per bucket.
  const paths: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
  const bucketPx: number[] = [];
  for (let b = 0; b < BUCKETS; b++) bucketPx.push(widthPx((b + 0.5) / BUCKETS));
  for (let k = 0; k + 1 < offsets.length; k++) {
    for (let v = offsets[k]; v + 1 < offsets[k + 1]; v++) {
      if (!front[v] || !front[v + 1]) continue; // segment crosses/behind the limb
      const w = (widths[v] + widths[v + 1]) * 0.5;
      if (w < revealCutoff) continue; // below the zoom reveal — a tributary not yet surfaced
      const b = Math.min(BUCKETS - 1, Math.max(0, Math.floor(w * BUCKETS)));
      paths[b].moveTo(sx[v], sy[v]);
      paths[b].lineTo(sx[v + 1], sy[v + 1]);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Casing pass (skipping hairlines), then the blue core on top.
  ctx.strokeStyle = CASING;
  for (let b = 0; b < BUCKETS; b++) {
    if (bucketPx[b] < CASING_MIN_PX) continue;
    ctx.lineWidth = bucketPx[b] + CASING_EXTRA_PX;
    ctx.stroke(paths[b]);
  }
  ctx.strokeStyle = CORE;
  for (let b = 0; b < BUCKETS; b++) {
    ctx.lineWidth = bucketPx[b];
    ctx.stroke(paths[b]);
  }
}
