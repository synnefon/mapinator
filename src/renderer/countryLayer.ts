import type { GlobeMap } from "../common/map";
import type { Projector } from "./projection";

// The "countries" overlay: a 25%-red territory fill for the hovered country (under) + dotted red
// borders (over), on its own 2D canvas layered over the globe. The country choropleth (whole-map
// tint) is NOT here — it's baked into the globe's per-cell colours on the GPU (see computeCellColors).
// Country NAMES are interactive DOM elements (see CountryLabels). Projected each frame; data per map.
const DASH = [3, 4]; // dotted border pattern, px
const BORDER = "rgba(190,25,25,0.95)";
const BORDER_WIDTH = 1.6;
const HIGHLIGHT = "rgba(205,30,30,0.25)"; // hovered country's land territory — 25% red

/** The country to highlight on hover — its land cells (read off `countryOf`) are filled. */
export type CountryHighlight = { map: GlobeMap; countryOf: Int32Array; index: number };

export function drawCountries(
  canvas: HTMLCanvasElement,
  borders: Float32Array,
  highlight: CountryHighlight | null,
  proj: Projector
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (borders.length === 0 && !highlight) return;

  // --- hovered country's territory: fill its front-facing land cells, 25% red, beneath the borders ---
  if (highlight) {
    const { map, countryOf, index } = highlight;
    const { cellCount, sites, ringOffsets, ringVerts } = map;
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    for (let i = 0; i < cellCount; i++) {
      if (countryOf[i] !== index) continue;
      const s = proj.project({ x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
      if (s.z <= 0) continue; // back hemisphere
      const start = ringOffsets[i];
      for (let v = start; v < ringOffsets[i + 1]; v++) {
        const r = proj.project({ x: ringVerts[3 * v], y: ringVerts[3 * v + 1], z: ringVerts[3 * v + 2] });
        if (v === start) ctx.moveTo(r.x, r.y);
        else ctx.lineTo(r.x, r.y);
      }
      ctx.closePath();
    }
    ctx.fill();
  }

  // --- borders: one dashed-red path, stroked once ---
  ctx.setLineDash(DASH);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = BORDER_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < borders.length; i += 6) {
    const a = proj.project({ x: borders[i], y: borders[i + 1], z: borders[i + 2] });
    const b = proj.project({ x: borders[i + 3], y: borders[i + 4], z: borders[i + 5] });
    if (!a.front || !b.front) continue; // crosses or sits behind the limb
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
