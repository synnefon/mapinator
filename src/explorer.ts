import { Quat, Vec3 } from "./common/3DMath";
import type { Theme } from "./common/biomes";
import type { GlobeMap } from "./common/map";
import {
  applyTuning,
  TUNING_SCHEMA,
  tuningDefault,
  type MapSettings,
  type TuningOverrides,
} from "./common/settings";
import { GlobeController } from "./renderer/GlobeController";
import { globeRadiusPx } from "./renderer/GlobeRenderer";
import { MapGenerator } from "./mapgen/MapGenerator";
import { createGlobeRenderer } from "./renderer/WebGLGlobeRenderer";

/* ─── A/B binary-search tuning wizard (served at /tune, localhost only) ─────────
 * Walks every tunable dial (derived from settings.ts TUNING_SCHEMA — NOT a hardcoded list; exclude
 * one via DIAL_OPTOUT in settings.ts) and binary-searches it with TWO interactive globes (shared
 * view — drag/zoom either, both move together). For each dial the search span starts a bit BELOW
 * the dial's current range and a bit ABOVE it; A sits at the lower quartile of the shrinking [lo,hi],
 * B at the upper quartile, and picking a side halves the range toward it — reestablishing the centre.
 * Narrow as many rounds as you like, then ✓ lock & next commits the centre. Locks accumulate in
 * memory; 💾 save writes them all to settings.ts at once (recentering each dial's range around the
 * pick, preserve width, via POST /tune/write) and reloads.
 *
 * Detail-on-zoom (LOD): zooming in regenerates a finer cap at the view centre for both globes.
 * ──────────────────────────────────────────────────────────────────────────────── */

// One dial to binary-search, derived from the settings schema. `range` dials search their CENTRE
// (save recenters, preserving width); scalars search the value. min/max are the dial's slider bounds.
type Param = {
  path: string;
  range: boolean;
  min: number;
  max: number;
  view: "globe" | "highland";
};
const PARAMS: Param[] = TUNING_SCHEMA.flatMap((group) =>
  group.fields.map((f) => ({
    path: f.path,
    range: f.kind === "range",
    min: f.min,
    max: f.max,
    view: f.path.startsWith("MOUNTAIN") ? "highland" : "globe",
  }))
);

const THEME: Theme = "lush";
const CANVAS_PX = 440;
const TILE_RESOLUTION = 0.5; // global (base) mesh density
const HIGHLAND_ZOOM = 0.45; // start zoom for highland (mountain) params so the cap is on
const CAP_EXTRA_OCTAVES = 3; // extra noise detail to match a cap mesh's finer hexes
const CAP_ONSET = 0.3; // below this zoom: whole globe, no cap; at/above: a cap appears at the view centre
const GLOBE_VIEW = Quat.fromAxisAngle(1, 0, 0, -0.4); // whole-globe tilt so a pole shows
const SEARCH_MARGIN = 0.3; // how far past the current range to search, as a fraction of |centre|…
const SEARCH_MIN = 0.05; // …with this floor so near-zero dials still get a usable span
const REGEN_DEBOUNCE_MS = 180; // wait for the view to settle before regenerating the detail cap
const WRITE_URL = "/tune/write";
const PROGRESS_KEY = "tune.progress"; // survives reloads (save reload, manual reload)
const LOG_KEY = "tune.log";
// ────────────────────────────────────────────────────────────────────────────────

type WriteResponse = {
  ok: boolean;
  error?: string;
  results?: { path: string; value: number | number[] }[];
};

/** Overrides pinning a param to a single value (range → [v,v], scalar → v). */
const overridesForParam = (param: Param, v: number): TuningOverrides =>
  param.range ? { [`${param.path}.0`]: v, [`${param.path}.1`]: v } : { [param.path]: v };

const randomSeed = (): string => Math.random().toString(36).slice(2, 9);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;
const short = (path: string): string => path.split(".").pop() ?? path;

// ── DOM ──
const progress = document.getElementById("progress") as HTMLSpanElement;
const configEl = document.getElementById("config") as HTMLPreElement;
const seedInput = document.getElementById("seed") as HTMLInputElement;
const backBtn = document.getElementById("back") as HTMLButtonElement;
const skipBtn = document.getElementById("skip") as HTMLButtonElement;
const lockBtn = document.getElementById("lock") as HTMLButtonElement;
const restartBtn = document.getElementById("restart") as HTMLButtonElement;
const regenBtn = document.getElementById("regen") as HTMLButtonElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const canvasA = document.getElementById("canvasA") as HTMLCanvasElement;
const canvasB = document.getElementById("canvasB") as HTMLCanvasElement;
const pickABtn = document.getElementById("pickA") as HTMLButtonElement;
const pickBBtn = document.getElementById("pickB") as HTMLButtonElement;
const labelA = document.getElementById("labelA") as HTMLDivElement;
const labelB = document.getElementById("labelB") as HTMLDivElement;
const globesEl = document.getElementById("globes") as HTMLDivElement;

const renderer = createGlobeRenderer();
const gen = new MapGenerator(randomSeed());
for (const c of [canvasA, canvasB]) {
  c.width = CANVAS_PX;
  c.height = CANVAS_PX;
}

/** Cap mesh spec for a zoom level: null below CAP_ONSET (no cap), else a half-angle that covers the
 *  visible cap and a point count whose level (7→11) rises with zoom. */
function capSpecForZoom(zoom: number): { halfAngle: number; points: number } | null {
  if (zoom < CAP_ONSET) return null;
  const t = Math.min(1, (zoom - CAP_ONSET) / (1 - CAP_ONSET));
  const level = Math.round(lerp(7, 11, t));
  const points = 10 * 4 ** level + 2; // generateLocalMap re-derives the level from this
  const r = globeRadiusPx(canvasA, zoom);
  const visible = Math.asin(Math.min(1, (canvasA.width * 0.5 * Math.SQRT2) / r));
  return { halfAngle: Math.min(Math.PI / 2, (visible / 0.85) * 1.1), points };
}

// ── shared view (both globes track the same orientation + zoom) ──
let viewOrientation = GLOBE_VIEW;
let viewZoom = 0;

type GlobeState = {
  canvas: HTMLCanvasElement;
  base: GlobeMap | null;
  patch: GlobeMap | null;
  value: number | null; // the param value this globe is showing (for cap regeneration on zoom)
};
const globeA: GlobeState = { canvas: canvasA, base: null, patch: null, value: null };
const globeB: GlobeState = { canvas: canvasB, base: null, patch: null, value: null };

function renderGlobe(g: GlobeState): void {
  if (!g.base) return;
  const s: MapSettings = { resolution: TILE_RESOLUTION, zoom: viewZoom, theme: THEME };
  renderer.draw(g.canvas, g.base, s, viewOrientation, true, g.patch?.cap);
  if (g.patch) renderer.draw(g.canvas, g.patch, s, viewOrientation, false);
}

let renderPending = false;
function scheduleRenderBoth(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderGlobe(globeA);
    renderGlobe(globeB);
  });
}

// Detail cap follows the view: regenerate at the view centre once the view settles (debounced).
let regenTimer = 0;
function scheduleRegen(): void {
  clearTimeout(regenTimer);
  regenTimer = window.setTimeout(regenPatches, REGEN_DEBOUNCE_MS);
}
function regenPatches(): void {
  const param = PARAMS[paramIdx];
  if (!param) return; // done screen — nothing to refine
  for (const g of [globeA, globeB]) {
    if (g.value === null) continue;
    g.patch = makePatch(g.value, param); // null when zoomed back out → base only
    renderGlobe(g);
  }
}

/** A finer cap at the current view centre for `value`, sized to the current zoom (or null if out). */
function makePatch(value: number, param: Param): GlobeMap | null {
  const spec = capSpecForZoom(viewZoom);
  if (!spec) return null;
  applyTuning({ ...accumulated, ...overridesForParam(param, value) });
  gen.reSeed(seed);
  return gen.generateLocalMap(
    Quat.viewCenter(viewOrientation),
    spec.halfAngle,
    spec.points,
    CAP_EXTRA_OCTAVES
  );
}

// One controller per canvas, both driving the SHARED view → dragging/zooming either moves both,
// and a settle schedules a cap refresh at the new view centre.
for (const c of [canvasA, canvasB]) {
  new GlobeController({
    canvas: c,
    getView: () => ({ orientation: viewOrientation, zoom: viewZoom }),
    setView: (view) => {
      viewOrientation = view.orientation;
      viewZoom = view.zoom;
      scheduleRenderBoth();
      scheduleRegen();
    },
  });
}

// ── wizard state (resumed from sessionStorage so it survives the save reload) ──
type Progress = { paramIdx: number; seed: string; accumulated: TuningOverrides };
function loadProgress(): Progress | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) ?? "") as Progress;
    if (p && typeof p.paramIdx === "number" && typeof p.seed === "string" && p.accumulated) return p;
  } catch {
    /* fall through */
  }
  return null;
}
const resumed = loadProgress();
let paramIdx = resumed?.paramIdx ?? 0;
let seed = resumed?.seed ?? randomSeed();
let accumulated: TuningOverrides = resumed?.accumulated ?? {}; // locked param values so far
let lo = 0; // current param's shrinking search range
let hi = 0;
let round = 0;

const saveProgress = (): void =>
  sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ paramIdx, seed, accumulated }));

function logLine(text: string): void {
  const next = (sessionStorage.getItem(LOG_KEY) ?? "") + text + "\n";
  sessionStorage.setItem(LOG_KEY, next);
  configEl.textContent = next;
}

function setBusy(busy: boolean): void {
  for (const el of [pickABtn, pickBBtn, backBtn, skipBtn, lockBtn, restartBtn, regenBtn, saveBtn, seedInput]) {
    el.disabled = busy;
  }
  globesEl.style.opacity = busy ? "0.5" : "1";
}
const refreshSave = (): void => {
  saveBtn.disabled = Object.keys(accumulated).length === 0;
};

/** The param's current centre + half-width: from a lock made this session if present, else settings.ts. */
function currentValueOf(param: Param): { center: number; half: number } {
  if (param.range) {
    const k0 = `${param.path}.0`;
    const k1 = `${param.path}.1`;
    const has = k0 in accumulated;
    const v0 = has ? accumulated[k0] : tuningDefault(k0);
    const v1 = has ? accumulated[k1] : tuningDefault(k1);
    return { center: (v0 + v1) / 2, half: Math.abs(v1 - v0) / 2 };
  }
  const v = param.path in accumulated ? accumulated[param.path] : tuningDefault(param.path);
  return { center: v, half: 0 };
}

/** Elevation-weighted highland centroid of `ref` (the point highland params start facing). */
function highlandCenter(ref: GlobeMap): Vec3 {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < ref.cellCount; i++) {
    const w = ref.elevation[i];
    cx += ref.sites[3 * i] * w;
    cy += ref.sites[3 * i + 1] * w;
    cz += ref.sites[3 * i + 2] * w;
  }
  return Vec3.normalize({ x: cx, y: cy, z: cz });
}

/** Generate one globe's base + (zoom-driven) cap for param at value `v`. */
function rebuildGlobe(g: GlobeState, v: number, param: Param): void {
  applyTuning({ ...accumulated, ...overridesForParam(param, v) });
  gen.reSeed(seed);
  g.base = gen.generateMap({ resolution: TILE_RESOLUTION, zoom: 0, theme: THEME });
  g.value = v;
  g.patch = makePatch(v, param);
  renderGlobe(g);
}

/** Show the A/B pair for the current param's current [lo,hi]. */
function showCandidates(): void {
  const param = PARAMS[paramIdx];
  const vA = lerp(lo, hi, 0.25);
  const vB = lerp(lo, hi, 0.75);
  const center = (lo + hi) / 2;
  const halfW = (hi - lo) / 2;
  progress.textContent = `Param ${paramIdx + 1} / ${PARAMS.length} · ${param.path} · narrowed ${round}× · centre ≈ ${round2(center)} ±${round2(halfW)}`;
  labelA.textContent = `◀ ${short(param.path)} ≈ ${round2(vA)}`;
  labelB.textContent = `${short(param.path)} ≈ ${round2(vB)} ▶`;
  backBtn.disabled = paramIdx === 0 && round === 0;

  // Initial view: whole globe, or faced at the highlands (from the range midpoint) for mountain params.
  viewZoom = param.view === "highland" ? HIGHLAND_ZOOM : 0;
  if (param.view === "highland") {
    applyTuning({ ...accumulated, ...overridesForParam(param, center) });
    gen.reSeed(seed);
    const c = highlandCenter(gen.generateMap({ resolution: TILE_RESOLUTION, zoom: 0, theme: THEME }));
    viewOrientation = Quat.between(c, { x: 0, y: 0, z: 1 });
  } else {
    viewOrientation = GLOBE_VIEW;
  }

  // Stagger the two generations across frames so the UI doesn't hard-freeze on a pick.
  setBusy(true);
  requestAnimationFrame(() => {
    rebuildGlobe(globeA, vA, param);
    requestAnimationFrame(() => {
      rebuildGlobe(globeB, vB, param);
      setBusy(false);
      refreshSave();
    });
  });
}

function renderParam(): void {
  clearTimeout(regenTimer);
  const param = PARAMS[paramIdx];
  // Search a bit BELOW the current range to a bit ABOVE it (clamped to the dial's bounds); the
  // binary search then reestablishes the centre within that span.
  const { center, half } = currentValueOf(param);
  const margin = SEARCH_MARGIN * Math.max(Math.abs(center), SEARCH_MIN);
  lo = clamp(center - half - margin, param.min, param.max);
  hi = clamp(center + half + margin, param.min, param.max);
  round = 0;
  showCandidates();
}

/** Pick a side → halve the range toward it (as many rounds as you like; lock when satisfied). */
function pick(side: "A" | "B"): void {
  const mid = (lo + hi) / 2;
  if (side === "A") hi = mid;
  else lo = mid;
  round++;
  showCandidates();
}

/** Commit the current centre for this param and advance. */
function lock(): void {
  const param = PARAMS[paramIdx];
  const value = (lo + hi) / 2;
  accumulated = { ...accumulated, ...overridesForParam(param, value) };
  logLine(`✓ ${param.path} ≈ ${round2(value)}`);
  paramIdx++;
  saveProgress();
  renderCurrent();
}

function renderCurrent(): void {
  if (paramIdx >= PARAMS.length) renderDone();
  else renderParam();
}

// Re-render the CURRENT position (same param + same [lo,hi]/round) WITHOUT resetting the binary
// search — used by regen / seed so swapping the world never loses your place.
function reshowCurrent(): void {
  if (paramIdx >= PARAMS.length) renderDone();
  else showCandidates();
}

function renderDone(): void {
  clearTimeout(regenTimer);
  progress.textContent = "✓ all parameters tuned — 💾 save to write settings.ts, or back / restart to revise.";
  labelA.textContent = "final";
  labelB.textContent = "final";
  viewOrientation = GLOBE_VIEW;
  viewZoom = 0;
  applyTuning(accumulated);
  gen.reSeed(seed);
  const base = gen.generateMap({ resolution: TILE_RESOLUTION, zoom: 0, theme: THEME });
  globeA.base = base;
  globeA.patch = null;
  globeA.value = null;
  globeB.base = base;
  globeB.patch = null;
  globeB.value = null;
  renderGlobe(globeA);
  renderGlobe(globeB);
  setBusy(false);
  pickABtn.disabled = true;
  pickBBtn.disabled = true;
  skipBtn.disabled = true;
  lockBtn.disabled = true;
  backBtn.disabled = paramIdx === 0;
  refreshSave();
}

/** Write every locked pick to settings.ts at once (recentered), then reload onto the new file. */
async function save(): Promise<void> {
  const picks = PARAMS.filter((p) => (p.range ? `${p.path}.0` : p.path) in accumulated).map((p) => ({
    path: p.path,
    value: p.range ? accumulated[`${p.path}.0`] : accumulated[p.path],
  }));
  if (picks.length === 0) return;
  setBusy(true);
  try {
    const res = await fetch(WRITE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks }),
    });
    const json = (await res.json()) as WriteResponse;
    if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    // Reset the picks log to just a save confirmation — the picks are now baked into settings.ts.
    sessionStorage.setItem(LOG_KEY, `✓ saved ${json.results?.length ?? 0} dials to settings.ts\n`);
    accumulated = {};
    paramIdx = 0;
    saveProgress();
    location.reload(); // re-import the rewritten settings.ts as the new baseline
  } catch (e) {
    progress.textContent = `⚠ save failed: ${e instanceof Error ? e.message : String(e)}`;
    setBusy(false);
  }
}

// ── controls ──
pickABtn.onclick = () => pick("A");
pickBBtn.onclick = () => pick("B");
lockBtn.onclick = lock;
backBtn.onclick = () => {
  if (round > 0) renderParam(); // undo this param's narrowing (restart its search)
  else {
    paramIdx = Math.max(0, paramIdx - 1);
    saveProgress();
    renderCurrent();
  }
};
skipBtn.onclick = () => {
  paramIdx++; // leave this param at its current value, no lock
  saveProgress();
  renderCurrent();
};
// Restart the walk from the first parameter WITHOUT dropping locked values.
restartBtn.onclick = () => {
  paramIdx = 0;
  saveProgress();
  renderCurrent();
};
// Just swap the world — new seed, SAME place in the process (keeps param + binary-search position).
regenBtn.onclick = () => {
  seed = randomSeed();
  seedInput.value = seed;
  saveProgress();
  reshowCurrent();
};
seedInput.onchange = () => {
  seed = seedInput.value || randomSeed();
  seedInput.value = seed;
  saveProgress();
  reshowCurrent();
};
saveBtn.onclick = () => void save();

// boot
seedInput.value = seed;
configEl.textContent = sessionStorage.getItem(LOG_KEY) ?? "";
renderCurrent();
