import { globeRadiusPx } from "./GlobeRenderer";

/**
 * Cap mesh spec for a SQUARE dev-harness canvas at a zoom: null below `onset` (whole globe, no cap),
 * else a half-angle covering the visible disk plus a point count whose Goldberg level (7→11) rises
 * with zoom. The one definition shared by the /tune wizard and /sweep, so the two harnesses can't
 * drift. The LIVE app's cap sizing is LodPipeline's (its own ladder + preload-margin model) —
 * deliberately NOT this.
 */
export function capSpecForZoom(
  canvas: { width: number; height: number },
  zoom: number,
  onset: number
): { halfAngle: number; points: number } | null {
  if (zoom < onset) return null;
  const t = Math.min(1, (zoom - onset) / (1 - onset));
  const level = Math.round(7 + 4 * t); // Goldberg cap levels 7..11
  const points = 10 * 4 ** level + 2; // generateLocalMap re-derives the level from this
  const r = globeRadiusPx(canvas, zoom);
  const visible = Math.asin(Math.min(1, (canvas.width * 0.5 * Math.SQRT2) / r));
  return { halfAngle: Math.min(Math.PI / 2, (visible / 0.85) * 1.1), points };
}
