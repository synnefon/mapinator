import { Quat } from "../common/3DMath";
import type { GlobeMap } from "../common/map";
import { globeRadiusPx } from "./GlobeRenderer";

// The "countries" overlay on its own 2D canvas over the globe: an optional 4-colour choropleth (every
// land cell tinted by its country, 15% opacity), the 25%-red territory fill for the hovered country, and
// dotted red borders — drawn bottom-to-top in that order. Country NAMES are interactive DOM elements
// (see CountryLabels), not drawn here. Projected each frame; the data is computed per map.
const MIN_FRONT_Z = 0.04; // cull borders at/behind the visible limb
const DASH = [3, 4]; // dotted border pattern, px
const BORDER = "rgba(190,25,25,0.95)";
const BORDER_WIDTH = 1.6;
const HIGHLIGHT = "rgba(205,30,30,0.25)"; // hovered country's land territory — 25% red
// Four-colour choropleth palette at 15% opacity. Adjacent countries never share a class (see
// fourColorCountries), so neighbours stay distinct even at low alpha.
const FILL_COLORS = [
  "rgba(220,70,70,0.15)",
  "rgba(70,120,220,0.15)",
  "rgba(80,180,90,0.15)",
  "rgba(220,180,60,0.15)",
];

/** The country to highlight on hover — its land cells (read off `countryOf`) are filled. */
export type CountryHighlight = { map: GlobeMap; countryOf: Int32Array; index: number };

/** The whole-map choropleth: every land cell filled by its country's 0–3 colour class, 15% opacity. */
export type CountryFill = { map: GlobeMap; countryOf: Int32Array; colorClass: Int32Array };

export function drawCountries(
  canvas: HTMLCanvasElement,
  borders: Float32Array,
  highlight: CountryHighlight | null,
  orientation: Quat,
  zoom: number,
  offsetFraction: number,
  fill: CountryFill | null = null
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  if (borders.length === 0 && !highlight && !fill) return;

  const radius = globeRadiusPx(canvas, zoom);
  const offX = offsetFraction * W;
  const cx = W / 2;
  const cy = H / 2;

  // --- choropleth: trace every front-facing land cell into one path per colour class, then 4 fills ---
  if (fill) {
    const { map, countryOf, colorClass } = fill;
    const { cellCount, sites, ringOffsets, ringVerts } = map;
    const paths = FILL_COLORS.map(() => new Path2D());
    for (let i = 0; i < cellCount; i++) {
      const ci = countryOf[i];
      if (ci < 0) continue; // ocean / uninhabited
      const s = Quat.rotate(orientation, { x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
      if (s.z <= 0) continue; // back hemisphere
      const path = paths[colorClass[ci]] ?? paths[0];
      const start = ringOffsets[i];
      for (let v = start; v < ringOffsets[i + 1]; v++) {
        const r = Quat.rotate(orientation, {
          x: ringVerts[3 * v],
          y: ringVerts[3 * v + 1],
          z: ringVerts[3 * v + 2],
        });
        const x = cx + r.x * radius + offX;
        const y = cy - r.y * radius;
        if (v === start) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
    }
    for (let c = 0; c < paths.length; c++) {
      ctx.fillStyle = FILL_COLORS[c];
      ctx.fill(paths[c]);
    }
  }

  // --- hovered country's territory: fill its front-facing land cells, 25% red, beneath the borders ---
  if (highlight) {
    const { map, countryOf, index } = highlight;
    const { cellCount, sites, ringOffsets, ringVerts } = map;
    ctx.fillStyle = HIGHLIGHT;
    ctx.beginPath();
    for (let i = 0; i < cellCount; i++) {
      if (countryOf[i] !== index) continue;
      const s = Quat.rotate(orientation, { x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
      if (s.z <= 0) continue; // back hemisphere
      const start = ringOffsets[i];
      for (let v = start; v < ringOffsets[i + 1]; v++) {
        const r = Quat.rotate(orientation, {
          x: ringVerts[3 * v],
          y: ringVerts[3 * v + 1],
          z: ringVerts[3 * v + 2],
        });
        const x = cx + r.x * radius + offX;
        const y = cy - r.y * radius;
        if (v === start) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
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
    const a = Quat.rotate(orientation, { x: borders[i], y: borders[i + 1], z: borders[i + 2] });
    const b = Quat.rotate(orientation, { x: borders[i + 3], y: borders[i + 4], z: borders[i + 5] });
    if (a.z < MIN_FRONT_Z || b.z < MIN_FRONT_Z) continue; // crosses or sits behind the limb
    ctx.moveTo(cx + a.x * radius + offX, cy - a.y * radius);
    ctx.lineTo(cx + b.x * radius + offX, cy - b.y * radius);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
