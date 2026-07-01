import { Quat, Vec3 } from "./common/3DMath";
import type { Theme } from "./common/biomes";
import {
  applyTuning,
  type MapSettings,
  snapshotParams,
  type TuningOverrides,
} from "./common/settings";
import { MapGenerator } from "./mapgen/MapGenerator";
import { capSpecForZoom } from "./renderer/capSpec";
import { createGlobeRenderer } from "./renderer/WebGLGlobeRenderer";

/* ─── Tectonic mountain sweep (served at /sweep, dev only) ──────────────────────
 * A labeled grid of the terrain over a PERFECTLY FLAT low-elevation base — continentalness is
 * forced (MapGenerator.flatBaseC), so the base is a flat green plain and ONLY the MOUNTAIN +
 * TECTONIC dials change between tiles. Rows sweep one dial, cols another; every other dial
 * sits at its current settings.ts value. Same seed + camera for every tile, so differences are
 * purely the two swept dials. Edit the config block below and reload to retarget the sweep.
 * ──────────────────────────────────────────────────────────────────────────── */

// ── sweep config (edit freely, then reload) ──────────────────────────────────
const ROWS = {
  path: "TECTONICS.PLATE_COUNT",
  label: "plates",
  values: [6, 10, 14, 18, 24, 30],
};
const COLS = {
  path: "TECTONICS.RANGE_WIDTH",
  label: "width",
  values: [0.08, 0.14, 0.2, 0.26, 0.32, 0.4],
};
const FLAT_C = 1; // forced continentalness: 1 = fully inland → flat low land + full-strength mountains
const THEME: Theme = "lush";
const TILE_PX = 260;
const ZOOM = 0.5; // cap zoom so peaks read clearly
const BASE_RES = 0.5; // global base mesh density (flat plain behind the cap)
// Fixed view (a point off the poles) — identical camera for every tile.
const CAP_CENTER = Vec3.normalize({ x: 0.25, y: 0.32, z: 1 });
const ORIENTATION = Quat.between(CAP_CENTER, { x: 0, y: 0, z: 1 });
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (x: number): number => Math.round(x * 100) / 100;
const randomSeed = (): string => Math.random().toString(36).slice(2, 9);
const raf = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => r()));

// ── DOM ──
const grid = document.getElementById("grid") as HTMLDivElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const regenBtn = document.getElementById("regen") as HTMLButtonElement;
const downloadBtn = document.getElementById("download") as HTMLButtonElement;
const sheetBtn = document.getElementById("sheet") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const axesEl = document.getElementById("axes") as HTMLDivElement;

axesEl.textContent =
  `rows ↓ ${ROWS.path} [${ROWS.values.join(", ")}]   ·   ` +
  `cols → ${COLS.path} [${COLS.values.join(", ")}]   ·   flat base (C=${FLAT_C})`;
grid.style.gridTemplateColumns = `repeat(${COLS.values.length}, ${TILE_PX}px)`;

// One WebGL canvas does all the rendering (browsers cap live GL contexts at ~16, so we can't
// give each of the 25 tiles its own); each tile is a cheap 2D canvas we blit the GL frame into.
const renderer = createGlobeRenderer();
const glCanvas = Object.assign(document.createElement("canvas"), {
  width: TILE_PX,
  height: TILE_PX,
});
const gen = new MapGenerator(randomSeed(), snapshotParams());

// Cap spec for the fixed zoom: the dense patch's half-angle (cover the visible disk) + point
// count (its level). The one definition shared with the /tune wizard (renderer/capSpec.ts).
const CAP = capSpecForZoom(glCanvas, ZOOM, 0.3)!; // ZOOM is above onset, so a cap always exists

type Tile = { canvas: HTMLCanvasElement; row: number; col: number };
let tiles: Tile[] = [];

// Render one (rowVal, colVal) cell into the shared GL canvas, then blit it into `tile2d`.
function renderTile(
  tile2d: HTMLCanvasElement,
  seed: string,
  rowVal: number,
  colVal: number
): void {
  const ov: TuningOverrides = { [ROWS.path]: rowVal, [COLS.path]: colVal };
  applyTuning(ov); // sets the two swept dials; every other dial reverts to its settings.ts value
  gen.configure(seed, snapshotParams()); // same seed → same noise; re-resolve params from the tuned dials
  // FLAT_C forces continentalness flat (the /sweep flat-base hook) so only MOUNTAIN/TECTONIC vary.
  const base = gen.generateMap({ resolution: BASE_RES, zoom: 0, theme: THEME }, FLAT_C);
  const cap = gen.generateLocalMap(
    CAP_CENTER,
    CAP.halfAngle,
    CAP.points,
    FLAT_C
  );
  const s: MapSettings = { resolution: BASE_RES, zoom: ZOOM, theme: THEME };
  renderer.draw(glCanvas, base, s, ORIENTATION, true, cap.cap);
  renderer.draw(glCanvas, cap, s, ORIENTATION, false);
  const ctx = tile2d.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  ctx.drawImage(glCanvas, 0, 0); // preserveDrawingBuffer (renderer) → frame is still readable
}

function setBusy(busy: boolean): void {
  for (const el of [regenBtn, downloadBtn, sheetBtn, seedInput]) el.disabled = busy;
}

async function buildGrid(seed: string): Promise<void> {
  setBusy(true);
  grid.innerHTML = "";
  tiles = [];
  const total = ROWS.values.length * COLS.values.length;
  let n = 0;
  for (let ri = 0; ri < ROWS.values.length; ri++) {
    for (let ci = 0; ci < COLS.values.length; ci++) {
      const rv = ROWS.values[ri];
      const cv = COLS.values[ci];
      const fig = document.createElement("figure");
      const canvas = Object.assign(document.createElement("canvas"), {
        width: TILE_PX,
        height: TILE_PX,
      });
      const caption = document.createElement("figcaption");
      caption.textContent = `${ROWS.label}=${round2(rv)} · ${COLS.label}=${round2(cv)}`;
      fig.append(canvas, caption);
      grid.appendChild(fig);
      renderTile(canvas, seed, rv, cv);
      tiles.push({ canvas, row: ri, col: ci });
      statusEl.textContent = `rendering ${++n}/${total}…`;
      await raf(); // yield so tiles fill in progressively instead of freezing the tab
    }
  }
  statusEl.textContent = `done · ${total} tiles`;
  setBusy(false);
}

// Trigger a browser download of a canvas as a PNG.
function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: filename,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

// One labeled PNG per tile.
function downloadAll(): void {
  for (const t of tiles) {
    const name = `mtn_${ROWS.label}${round2(ROWS.values[t.row])}_${COLS.label}${round2(COLS.values[t.col])}.png`;
    downloadCanvas(t.canvas, name);
  }
}

// One combined, labeled contact sheet PNG (row/col headers + per-tile labels).
function downloadSheet(): void {
  const pad = 8;
  const labelH = 18;
  const headH = 22;
  const rowLabelW = 78;
  const cols = COLS.values.length;
  const rows = ROWS.values.length;
  const cellH = TILE_PX + labelH;
  const W = rowLabelW + cols * (TILE_PX + pad) + pad;
  const H = headH + rows * (cellH + pad) + pad;
  const sheet = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = sheet.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, W, H);
  ctx.font = "12px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  // column headers
  ctx.fillStyle = "#9bd";
  ctx.textAlign = "center";
  for (let ci = 0; ci < cols; ci++) {
    const x = rowLabelW + ci * (TILE_PX + pad) + TILE_PX / 2;
    ctx.fillText(`${COLS.label}=${round2(COLS.values[ci])}`, x, headH / 2);
  }
  for (const t of tiles) {
    const x = rowLabelW + t.col * (TILE_PX + pad);
    const y = headH + t.row * (cellH + pad);
    ctx.drawImage(t.canvas, x, y, TILE_PX, TILE_PX);
    ctx.fillStyle = "#ccc";
    ctx.textAlign = "center";
    ctx.fillText(
      `${ROWS.label}=${round2(ROWS.values[t.row])} · ${COLS.label}=${round2(COLS.values[t.col])}`,
      x + TILE_PX / 2,
      y + TILE_PX + labelH / 2
    );
    if (t.col === 0) {
      ctx.fillStyle = "#9bd";
      ctx.textAlign = "left";
      ctx.fillText(`${ROWS.label}=${round2(ROWS.values[t.row])}`, 4, y + TILE_PX / 2);
    }
  }
  downloadCanvas(sheet, "tectonic_sweep.png");
}

// ── boot ──
let seed = randomSeed();
seedInput.value = seed;
regenBtn.onclick = () => {
  seed = randomSeed();
  seedInput.value = seed;
  void buildGrid(seed);
};
seedInput.onchange = () => {
  seed = seedInput.value || randomSeed();
  seedInput.value = seed;
  void buildGrid(seed);
};
downloadBtn.onclick = downloadAll;
sheetBtn.onclick = downloadSheet;
void buildGrid(seed);
