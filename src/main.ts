import { v4 as uuid } from "uuid";
import { AppState } from "./AppState";
import type { GlobeMap } from "./common/map";
import {
  qFromAxisAngle,
  qMul,
  qNormalize,
  qRotate,
  qSlerp,
  QUAT_IDENTITY,
  quatViewCenter,
  type Quat,
} from "./common/rotation";
import { LOD, MAP_DEFAULTS, type MapSettings } from "./common/settings";
import { applyThemeUIColors, generateThemeButtonCSS } from "./common/themeColors";
import type { Vec3 } from "./common/vec3";
import { globePointCount } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MAX_TITLE_LEN, setupMenuBar } from "./MenuBar";
import { createCompassNeedle } from "./renderer/compassNeedle";
import { GlobeController } from "./renderer/GlobeController";
import { globeRadiusPx } from "./renderer/GlobeRenderer";
import { createGlobeRenderer } from "./renderer/WebGLGlobeRenderer";
import { sliderDefs, UIManager } from "./UIManager";

// --- Setup & State ---
const mapCache = new Map<string, GlobeMap>();

// Level-of-detail. Zoomed out we draw the whole-globe mesh; zoomed in we mesh a cap BIGGER
// than the view (PATCH_PRELOAD_MARGIN = preload so panning is already loaded) from the global Fibonacci
// point set, layering `octaves` of finer detail. `points` is that density.
//
// The ladder is DERIVED, not hand-placed: `points` steps geometrically (×DENSITY_STEP_RATIO) from the
// global mesh up to FINEST_PATCH_POINTS, and each rung's activation ZOOM is where that same
// geometric density curve (global at zoom 0 → max at zoom 1) reaches its density. DETAIL_BIAS
// bends the curve earlier/later. All tunable in settings.ts (LOD); destructured for the math.
const {
  RECENTER_FRACTION,
  FINEST_PATCH_POINTS,
  COARSEST_PATCH_POINTS,
  DENSITY_STEP_RATIO,
  DETAIL_BIAS,
  PATCH_PRELOAD_MARGIN,
  FINEST_EXTRA_OCTAVES,
  MIN_EXPORT_POINTS,
} = LOD;
// The global mesh is the curve's zoom-0 anchor (rung 0, 0 extra octaves).
const GLOBAL_POINTS = globePointCount(MAP_DEFAULTS.resolution);

type PatchLevel = {
  aboveZoom: number; // activate this level once zoom ≥ this (0..1)
  points: number;
  octaves: number;
};

/** LOD ladder, coarsest → finest, sampled from the geometric density-vs-zoom curve. */
function buildPatchLevels(): PatchLevel[] {
  const points: number[] = [];
  for (let p = FINEST_PATCH_POINTS; p >= COARSEST_PATCH_POINTS; p /= DENSITY_STEP_RATIO) {
    points.unshift(p);
  }
  // Geometric curve: global density at zoom 0 → FINEST_PATCH_POINTS at zoom 1. A rung of density p
  // sits at t = ln(p/global)/ln(max/global). We shift each trigger half a rung earlier so a
  // level is active around the zoom it best fits (and the finest gets a band, not just zoom 1).
  const span = Math.log(FINEST_PATCH_POINTS / GLOBAL_POINTS);
  const halfRung = (0.5 * Math.log(DENSITY_STEP_RATIO)) / span;
  return points.map((p, i) => {
    const t = Math.log(p / GLOBAL_POINTS) / span; // 0..1 along the curve (1 at MAX)
    // DETAIL_BIAS > 1 pulls denser detail to lower zoom (earlier).
    const aboveZoom = Math.pow(Math.max(0, Math.min(1, t - halfRung)), DETAIL_BIAS);
    return {
      points: p,
      aboveZoom: parseFloat(aboveZoom.toFixed(4)),
      // Octaves spread evenly from the global mesh (rung 0, 0 extra octaves) up to the finest
      // patch (FINEST_EXTRA_OCTAVES). Patch i is rung i+1 of points.length rungs above the global.
      octaves: Math.round((FINEST_EXTRA_OCTAVES * (i + 1)) / points.length),
    };
  });
}
const PATCH_LEVELS: PatchLevel[] = buildPatchLevels();

document.addEventListener("DOMContentLoaded", () => {
  // Inject theme styles
  document.head.appendChild(
    Object.assign(document.createElement("style"), {
      textContent: generateThemeButtonCSS(),
    })
  );
  // Setup SVG/CSS masks for button images
  document
    .querySelectorAll<HTMLImageElement>("img.button-img, img.button-img-small")
    .forEach((img) => {
      const src = img.getAttribute("src");
      if (src) {
        // Quote the URL: in production Vite inlines the SVG as a url-encoded data URI
        // containing raw single quotes, which breaks an UNquoted CSS url() (the icon then
        // vanishes). Base64 PNG data URIs and file paths are fine quoted too.
        img.style.maskImage = img.style.webkitMaskImage = `url("${src}")`;
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      }
    });

  // App objects & state
  const appState = new AppState();
  const ui = new UIManager();
  const nameGenerator = new NameGenerator(uuid());
  const genOneName = () =>
    nameGenerator.generate({
      lang: appState.selectedLanguages.length
        ? appState.selectedLanguages[
        Math.floor(Math.random() * appState.selectedLanguages.length)
        ]
        : undefined,
    });
  // Keep generated names within the title limit: retry a few times, truncate as a fallback.
  const generateMapName = () => {
    for (let i = 0; i < 20; i++) {
      const name = genOneName();
      if (name.length <= MAX_TITLE_LEN) return name;
    }
    return genOneName().slice(0, MAX_TITLE_LEN);
  };

  // Initialize mapName if not already set
  if (!appState.mapName) {
    appState.mapName = generateMapName();
  }

  const globeRenderer = createGlobeRenderer();
  // Live view orientation (world→view quaternion), driven by the orbit controls;
  // reset on regen. Replaced wholesale by setView (not mutated in place).
  let orientation: Quat = QUAT_IDENTITY;
  // rAF handle for the north-align animation (see orientNorth); any user view change
  // cancels it so a drag/zoom mid-animation takes over cleanly.
  let northAnim: number | null = null;
  // Whole-globe vs detail-patch, last seen — so the tools auto-toggle only when it flips.
  let lastLocal: boolean | null = null;
  // Filled in by setupMenuBar (below): main calls these for auto-collapse (setView) and to
  // show the current map name in the title input (redraw).
  let setToolsCollapsed: (collapsed: boolean) => void = () => { };
  let setTitle: (name: string) => void = () => { };

  // UI Elements (main keeps the canvas + the north overlay; the rest live in the menu).
  const { map: canvas, northBtn } = ui.getAllElements();

  // The north button's 3D compass needle (Zdog), spun each frame to point at north.
  const northCanvas = northBtn.querySelector<HTMLCanvasElement>("#northCompass");
  const needle = northCanvas ? createCompassNeedle(northCanvas) : null;
  // Brighten to the hover colour while the button is hovered (matches the other buttons).
  northBtn.addEventListener("mouseenter", () => needle?.recolor("--highlightText"));
  northBtn.addEventListener("mouseleave", () => needle?.recolor("--text"));

  // Settings changes fan out from the store: slider labels and theme colours/needle react
  // here, so callers just setSetting and don't hand-sync the UI at every call site.
  const sliderKeys = new Set(sliderDefs.map((d) => d.key));
  appState.subscribe((key) => {
    if (key === "theme") {
      applyThemeUIColors(appState.settings.theme);
      needle?.recolor();
    } else if (sliderKeys.has(key)) {
      ui.updateSliderValue(key, appState.settings[key]);
    }
  });

  // Orbit controls: drag = rotate, wheel/pinch = zoom. Mutates orientation + the
  // zoom setting and redraws; geometry is untouched, so this only re-projects.
  const controller = new GlobeController({
    canvas,
    getView: () => ({ orientation, zoom: appState.settings.zoom }),
    setView: (view) => {
      if (northAnim !== null) {
        cancelAnimationFrame(northAnim); // a drag/zoom interrupts the north animation
        northAnim = null;
      }
      orientation = view.orientation;
      if (view.zoom !== appState.settings.zoom) {
        appState.setSetting("zoom", view.zoom); // subscriber syncs the slider
      }
      // A map zoom gesture (wheel/pinch) crossing globe↔detail auto-toggles the tools — only on
      // the transition, so manual toggles stick. Slider zoom never calls setView, so dragging
      // the zoom slider won't collapse the menu.
      const local = currentView().local;
      if (local !== lastLocal) setToolsCollapsed(local);
      drawMap();
    },
  });

  // The map canvas fills the whole page; keep its bitmap matched to the viewport so the globe
  // is neither letterboxed nor stretched. (The WebGL renderer reads canvas.width/height each
  // draw.) The initial call only sizes it — the first render comes through the normal init flow.
  const resizeCanvas = (): boolean => {
    const w = Math.round(window.innerWidth);
    const h = Math.round(window.innerHeight);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  };
  resizeCanvas();
  window.addEventListener("resize", () => {
    if (resizeCanvas()) drawMap();
  });

  // --- Map Rendering ---
  // Terrain generation runs in a Web Worker so heavy meshing/noise never blocks the
  // UI thread; the globe's typed arrays transfer back zero-copy. Rotate/zoom only
  // re-project (reading the cached arrays), so they stay on the main thread.
  const worker = new Worker(new URL("./mapgen/mapWorker.ts", import.meta.url), {
    type: "module",
  });
  let reqId = 0;
  const pending = new Map<number, (map: GlobeMap) => void>();
  // Bumped on every seed change; results tagged with a stale epoch are dropped so an
  // in-flight build from the previous seed can't repopulate the cache.
  let seedEpoch = 0;

  // The whole-globe base mesh, always drawn underneath.
  let globalMap: GlobeMap | null = null;
  let globalInFlight = false;
  // Progressive octave LOD. As you zoom IN we queue every level you pass (coarse→fine) and
  // generate them ONE worker job at a time, upgrading `patchMap` (the overlay) to each finer
  // result as it lands. Finished patches are cached by (level, centre-bucket), so zooming out,
  // panning, or revisiting reuses them instead of recomputing — and `patchMap` is STICKY (it
  // only swaps to a finer/coarser CACHED patch, never blanks to the bare globe mid-build, so
  // the view never "restarts" blurry).
  let patchMap: GlobeMap | null = null;
  let patchMapLevel = -1; // the level of the patch currently shown (for switch hysteresis)
  const patchCache = new Map<string, GlobeMap>(); // "level|bx|by|bz" → patch (LRU by insertion)
  const PATCH_CACHE_CAP = 16; // finest patches are large; LRU keeps the working set + a little slack
  // The overlay must cover the view; a level is (re)queued once nothing covers this much MORE
  // than the view, so a replacement is built before the current patch's margin runs out (>1).
  const PATCH_COMFORT = 1.2;
  let octaveQueue: { key: string; level: number; center: Vec3 }[] = []; // missing levels, coarse→fine
  let octaveActive: string | null = null; // patch key currently in the worker

  worker.onmessage = (e: MessageEvent<{ id: number; map: GlobeMap }>) => {
    const resolve = pending.get(e.data.id);
    if (!resolve) return;
    pending.delete(e.data.id);
    resolve(e.data.map);
  };
  worker.onerror = (e) => {
    console.error("map worker error:", e.message);
  };

  type GenRequest =
    | { kind: "global"; settings: MapSettings }
    | {
      kind: "local";
      center: Vec3;
      halfAngle: number;
      points: number;
      extraOctaves: number;
    };

  const requestMap = (req: GenRequest): Promise<GlobeMap> =>
    new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      worker.postMessage({ id, ...req });
    });

  const reseedWorker = (seed: string) => {
    seedEpoch++; // discards any in-flight results from the previous seed
    worker.postMessage({ id: ++reqId, kind: "reSeed", seed });
  };

  // Seed the worker before the first generate (postMessage ordering keeps it first).
  reseedWorker(appState.mapName);

  function render() {
    // Spin the 3D compass needle to point along north's direction in view space (x right,
    // y up, z toward camera) — a live compass that foreshortens as north tilts in/out and,
    // being a solid, never collapses to nothing when you face a pole.
    if (needle) {
      needle.update(qRotate(orientation, { x: 0, y: 1, z: 0 }));
    }
    if (!globalMap) return;
    // When a patch is overlaid, skip the base cells it hides (its cap), so a
    // zoomed-in view doesn't redraw a full globe under the patch.
    globeRenderer.draw(
      canvas,
      globalMap,
      appState.settings,
      orientation,
      true,
      patchMap?.cap
    );
    if (patchMap) {
      globeRenderer.draw(canvas, patchMap, appState.settings, orientation, false);
    }
  }

  // Coalesce renders to one per animation frame: pointer/wheel events can fire
  // several times per frame, but the globe only needs re-projecting once.
  let renderPending = false;
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  // Animate the view orientation to `target` (slerp, ease in/out) at a roughly constant
  // angular pace, re-projecting each frame. Used by the north-align button so the globe
  // visibly rotates into place instead of snapping. A user drag/zoom cancels it (setView).
  const NORTH_MS_PER_RAD = 250; // pace; ~half-turn in ~0.8s
  const NORTH_MS_MIN = 300;
  const NORTH_MS_MAX = 800;
  function animateOrientationTo(target: Quat) {
    if (northAnim !== null) cancelAnimationFrame(northAnim);
    const start = orientation;
    const dot = Math.abs(
      start.x * target.x + start.y * target.y + start.z * target.z + start.w * target.w
    );
    const angle = 2 * Math.acos(Math.min(1, dot)); // rotation between start and target
    if (angle < 1e-4) {
      orientation = target;
      northAnim = null;
      scheduleRender();
      return;
    }
    const duration = Math.min(
      NORTH_MS_MAX,
      Math.max(NORTH_MS_MIN, angle * NORTH_MS_PER_RAD)
    );
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = t * t * (3 - 2 * t); // smoothstep ease in/out
      orientation = qSlerp(start, target, eased);
      render();
      northAnim = t < 1 ? requestAnimationFrame(step) : null;
    };
    northAnim = requestAnimationFrame(step);
  }

  // Whole-globe vs a dense local patch, decided from the current zoom + orientation.
  type LocalView = {
    local: true;
    level: number;
    center: Vec3;
    halfAngle: number;
    points: number;
    extraOctaves: number;
  };
  type View = { local: false } | LocalView;

  function currentView(): View {
    const zoom = appState.settings.zoom;
    // finest level whose activation zoom we've reached; -1 → whole globe
    let level = -1;
    for (let i = 0; i < PATCH_LEVELS.length; i++) {
      if (zoom >= PATCH_LEVELS[i].aboveZoom) level = i;
    }
    if (level < 0) return { local: false };
    const lv = PATCH_LEVELS[level];
    return {
      local: true,
      level,
      center: quatViewCenter(orientation),
      halfAngle: levelCap(level),
      points: lv.points,
      extraOctaves: lv.octaves,
    };
  }

  const globalKey = () => `g|${globePointCount(appState.settings.resolution)}`;

  // Cap (angular radius, radians) covering the view at a level's activation zoom, + preload
  // margin. Per level: coarser octaves get wider caps that still cover the current view.
  function levelCap(level: number): number {
    const radiusPx = globeRadiusPx(canvas, PATCH_LEVELS[level].aboveZoom);
    return (
      Math.asin(
        Math.min(1, (0.5 * Math.hypot(canvas.width, canvas.height)) / radiusPx)
      ) * PATCH_PRELOAD_MARGIN
    );
  }

  // Cache key for a level's patch at a centre, bucketed by the level's own cap so that small
  // pans (and the centre drift from zoom-to-cursor) reuse the same patch. Coarse levels get
  // bigger buckets (more pan-stable); fine levels finer ones.
  function bucketKey(level: number, center: Vec3): string {
    const step = levelCap(level) * RECENTER_FRACTION;
    const q = (n: number) => Math.round(n / step);
    return `${level}|${q(center.x)}|${q(center.y)}|${q(center.z)}`;
  }

  function cachePatch(key: string, map: GlobeMap): void {
    patchCache.set(key, map);
    while (patchCache.size > PATCH_CACHE_CAP) {
      const oldest = patchCache.keys().next().value; // insertion order → least-recently-used
      if (oldest === undefined) break;
      patchCache.delete(oldest);
    }
  }

  const levelOf = (key: string): number => Number(key.slice(0, key.indexOf("|")));

  // On-screen angular radius (radians) of the current view — the region the user actually sees
  // (no preload margin). A patch must cover at least this much around the centre to be usable.
  function viewExtentRadius(): number {
    const radiusPx = globeRadiusPx(canvas, appState.settings.zoom);
    return Math.asin(
      Math.min(1, (0.5 * Math.hypot(canvas.width, canvas.height)) / radiusPx)
    );
  }

  // Does a patch's cap fully contain the view disk (radius `vr`) around `center`?
  function capCovers(
    cap: { center: Vec3; cosKeep: number },
    center: Vec3,
    vr: number
  ): boolean {
    const d = cap.center.x * center.x + cap.center.y * center.y + cap.center.z * center.z;
    const dist = Math.acos(Math.max(-1, Math.min(1, d))); // angle centre→cap centre
    const capRadius = Math.acos(Math.max(-1, Math.min(1, cap.cosKeep)));
    return dist + vr <= capRadius;
  }

  // The finest LOD level the current zoom wants (or null for the whole-globe view).
  function octaveTarget(): { level: number; center: Vec3 } | null {
    const v = currentView();
    return v.local ? { level: v.level, center: v.center } : null;
  }

  // Sticky overlay: show the finest CACHED patch (≤ target, ANY bucket) whose cap still covers
  // the current view. Selecting by coverage — not by exact bucket — is what lets the patch you
  // already built keep showing while you pan inside its margin (no blurry downgrade). If nothing
  // covers yet, keep the previous patch rather than blanking to the bare globe.
  function refreshPatchMap(): void {
    const t = octaveTarget();
    if (!t) {
      patchMap = null;
      patchMapLevel = -1;
      return;
    }
    const vr = viewExtentRadius();
    let best: GlobeMap | null = null;
    let bestKey = "";
    let bestLevel = -1;
    for (const [key, patch] of patchCache) {
      const level = levelOf(key);
      if (level > t.level || level <= bestLevel || !patch.cap) continue;
      if (capCovers(patch.cap, t.center, vr)) {
        best = patch;
        bestKey = key;
        bestLevel = level;
      }
    }
    // Hysteresis: if the patch we're already showing still covers and nothing STRICTLY finer is
    // available, keep it. Without this we'd swap between equally-good, overlapping same-level
    // patches every frame (their caps differ → the patch/base edge flickers while panning).
    const currentCovers = !!patchMap?.cap && capCovers(patchMap.cap, t.center, vr);
    if (currentCovers && bestLevel <= patchMapLevel) return;
    if (best) {
      patchMap = best;
      patchMapLevel = bestLevel;
      patchCache.delete(bestKey); // LRU touch: keep the shown patch from being evicted
      patchCache.set(bestKey, best);
    }
  }

  // Keep the octave queue in sync with the view: a level needs (re)generating only when NO
  // cached patch at that level still covers the view — so panning within a patch's margin
  // regenerates nothing. Uncovered levels are queued coarse→fine at the current bucket.
  function syncOctaves(): void {
    const t = octaveTarget();
    if (!t) {
      patchMap = null; // whole globe: no overlay
      patchMapLevel = -1;
      octaveQueue = [];
      return;
    }
    // Queue against a slightly LARGER disk than the view (PATCH_COMFORT), so a replacement
    // starts generating before the current patch's margin is exhausted — no coarse blip on a
    // steady pan. The display test (refreshPatchMap) uses the true view, so the current patch
    // keeps showing meanwhile.
    const queueRadius = viewExtentRadius() * PATCH_COMFORT;
    // Levels already covered (with comfort) by some cached patch (any bucket) need no work.
    const covered = new Set<number>();
    for (const [key, patch] of patchCache) {
      if (patch.cap && capCovers(patch.cap, t.center, queueRadius)) covered.add(levelOf(key));
    }
    octaveQueue = [];
    for (let l = 0; l <= t.level; l++) {
      const key = bucketKey(l, t.center);
      if (!covered.has(l) && key !== octaveActive) {
        octaveQueue.push({ key, level: l, center: t.center });
      }
    }
    refreshPatchMap();
    pumpOctaves();
  }

  // Generate the next queued octave — ONE worker job at a time — caching + rendering each as it
  // lands, then pumping the next.
  function pumpOctaves(): void {
    if (octaveActive !== null) return; // one at a time
    const job = octaveQueue.shift();
    if (!job) return;
    if (patchCache.has(job.key)) {
      pumpOctaves(); // cached in the meantime
      return;
    }
    octaveActive = job.key;
    const epoch = seedEpoch;
    const lv = PATCH_LEVELS[job.level];
    requestMap({
      kind: "local",
      center: job.center,
      halfAngle: levelCap(job.level),
      points: lv.points,
      extraOctaves: lv.octaves,
    }).then((map) => {
      octaveActive = null;
      if (epoch === seedEpoch) {
        cachePatch(job.key, map);
        refreshPatchMap(); // a new patch landed → upgrade the overlay if it's the finest covering
        scheduleRender();
      }
      pumpOctaves(); // next octave (coarse → fine)
    });
  }

  // The whole-globe base mesh (one resolution, cached). Requested once; rebuilt on reseed.
  function ensureGlobal(): void {
    const gKey = globalKey();
    const cached = mapCache.get(gKey);
    if (cached) {
      globalMap = cached;
      return;
    }
    if (globalInFlight) return;
    globalInFlight = true;
    const epoch = seedEpoch;
    requestMap({ kind: "global", settings: { ...appState.settings } }).then((map) => {
      globalInFlight = false;
      if (epoch !== seedEpoch) return; // seed changed mid-flight
      mapCache.set(gKey, map);
      if (globalKey() === gKey) globalMap = map;
      scheduleRender();
    });
  }

  function ensureMap(): void {
    lastLocal = currentView().local; // for the menu auto-collapse (read in setView)
    ensureGlobal();
    syncOctaves();
    scheduleRender();
  }

  function resetAllMaps(): void {
    mapCache.clear();
    globalMap = null;
    globalInFlight = false;
    patchCache.clear();
    patchMap = null;
    patchMapLevel = -1;
    octaveQueue = [];
    // octaveActive's in-flight result is discarded by the seedEpoch bump in reseedWorker.
  }

  // View / setting change: re-render now (cheap) and keep the progressive octave stack synced.
  function drawMap(): void {
    scheduleRender();
    ensureMap();
  }

  // --- UI Helpers ---
  function redraw(newName?: string) {
    if (newName) {
      appState.mapName = newName;
    }
    setTitle(appState.mapName);
    ensureMap();
  }

  // Switch to the map with this seed/name, keeping the current view. Used when loading a
  // save file (which restores its own settings). New maps go through loadNewMap.
  function loadMap(name: string) {
    appState.mapName = name; // setter upper-cases it (case-insensitive keys)
    reseedWorker(appState.mapName);
    resetAllMaps();
    redraw();
  }

  // Reset the view to the default whole-globe, north-up orientation (the regen reset).
  function resetView() {
    controller.stopMomentum();
    orientation = QUAT_IDENTITY;
    appState.setSetting("zoom", 0); // subscriber syncs the slider
  }

  // Generate / switch to a NEW map (regen button or a typed name): always reset the view
  // first, then load — so a new map starts from the default view every time.
  function loadNewMap(name: string) {
    if (!name.trim()) {
      alert("Please enter the name of a map to load in");
      appState.mapName = "";
      setTitle("");
      return;
    }
    resetView();
    loadMap(name);
  }

  // Re-orient north, animating the globe into place. Zoomed in: a pure roll about the view
  // axis — keep your exact spot, just level north (no N/S or E/W movement). Whole-globe:
  // also rotate N/S onto the equator while keeping the current longitude — i.e. look at
  // (current lon, 0°) with north up, which is a pure spin about the world N/S axis, so it
  // never rotates E/W.
  northBtn.addEventListener("click", () => {
    controller.stopMomentum();
    let target: Quat;
    if (currentView().local) {
      const n = qRotate(orientation, { x: 0, y: 1, z: 0 }); // north in view space
      target = qNormalize(
        qMul(qFromAxisAngle(0, 0, 1, Math.atan2(n.x, n.y)), orientation)
      );
    } else {
      const c = quatViewCenter(orientation); // world point currently facing the camera
      const lon = Math.atan2(c.z, c.x); // keep this longitude; level latitude to 0
      target = qFromAxisAngle(0, 1, 0, lon - Math.PI / 2);
    }
    animateOrientationTo(target);
  });

  // Composite a rendered globe canvas under the titled header and download it.
  const downloadGlobePNG = (source: HTMLCanvasElement, title: string) => {
    const mapTitleText = title || "Untitled Map";
    const exportCanvas = Object.assign(document.createElement("canvas"), {
      width: source.width,
      height: source.height + 60,
    });
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    // Match the header band + title to the currently selected theme (its live CSS vars).
    const themeStyles = getComputedStyle(document.documentElement);
    const themeBg = themeStyles.getPropertyValue("--bg").trim() || "#dedede";
    const themeText = themeStyles.getPropertyValue("--text").trim() || "#000";
    ctx.fillStyle = themeBg;
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(source, 0, 60);
    ctx.font = "bold 36px 'Roboto Mono', monospace";
    ctx.fillStyle = themeText;
    ctx.textAlign = "center";
    ctx.fillText(mapTitleText, exportCanvas.width / 2, 40);
    const dataUrl = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `${mapTitleText.replace(/\s+/g, "_")}.png`;
    link.href = dataUrl;
    link.click();
  };

  const downloadPNG = (title: string) => {
    const view = currentView();
    // Whole-globe view (or no map yet): export exactly what's on screen.
    if (!view.local || !globalMap) {
      downloadGlobePNG(canvas, title);
      return;
    }
    // Zoomed in: re-render this patch at the export floor (denser than the live zoom
    // band) onto the live canvas at the on-screen framing, capture it, then restore
    // the live view. Rendering to the main canvas keeps a single GL context (the
    // WebGL path can't read back an offscreen canvas it never drew to). The worker
    // builds the dense patch off-thread.
    const base = globalMap;
    const points = Math.max(view.points, MIN_EXPORT_POINTS);
    requestMap({
      kind: "local",
      center: view.center,
      halfAngle: view.halfAngle,
      points,
      extraOctaves: view.extraOctaves,
    }).then((patch) => {
      globeRenderer.draw(
        canvas,
        base,
        appState.settings,
        orientation,
        true,
        patch.cap
      );
      globeRenderer.draw(canvas, patch, appState.settings, orientation, false);
      downloadGlobePNG(canvas, title);
      scheduleRender(); // restore the live (normal-density) view
    });
  };

  // Wire up the left-sidebar menu (title, tools toggle, sliders, theme, IO buttons).
  const menu = setupMenuBar({
    appState,
    ui,
    needle,
    generateMapName,
    drawMap,
    ensureMap,
    clearMapCache: () => resetAllMaps(),
    loadMap,
    loadNewMap,
    downloadPNG,
  });
  setToolsCollapsed = menu.setToolsCollapsed;
  setTitle = menu.setTitle;

  // --- Initialize ---
  redraw();
});
