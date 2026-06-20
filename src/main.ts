import { v4 as uuid } from "uuid";
import { AppState } from "./AppState";
import type { GlobeMap, Vec3 } from "./common/map";
import { LOD, MAP_DEFAULTS, type MapSettings } from "./common/settings";
import { generateThemeButtonCSS } from "./common/themeColors";
import { debounce } from "./common/util";
import { globePointCount } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { GlobeController } from "./renderer/GlobeController";
import { globeRadiusPx } from "./renderer/GlobeRenderer";
import { createGlobeRenderer } from "./renderer/WebGLGlobeRenderer";
import { createCompassNeedle } from "./renderer/compassNeedle";
import {
  QUAT_IDENTITY,
  quatViewCenter,
  qRotate,
  qFromAxisAngle,
  qMul,
  qNormalize,
  qSlerp,
  type Quat,
} from "./common/rotation";
import { UIManager } from "./UIManager";
import { MAX_TITLE_LEN, setupMenuBar } from "./MenuBar";

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
  MAX_LIVE_POINTS,
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
console.log("\nPATCH_LEVELS");
console.table(PATCH_LEVELS);

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
  let setToolsCollapsed: (collapsed: boolean) => void = () => {};
  let setTitle: (name: string) => void = () => {};

  // UI Elements (main keeps the canvas + the north overlay; the rest live in the menu).
  const { map: canvas, northBtn } = ui.getAllElements();

  // The north button's 3D compass needle (Zdog), spun each frame to point at north.
  const northCanvas = northBtn.querySelector<HTMLCanvasElement>("#northCompass");
  const needle = northCanvas ? createCompassNeedle(northCanvas) : null;
  // Brighten to the hover colour while the button is hovered (matches the other buttons).
  northBtn.addEventListener("mouseenter", () => needle?.recolor("--highlightText"));
  northBtn.addEventListener("mouseleave", () => needle?.recolor("--text"));

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
        appState.updateSetting("zoom", view.zoom);
        ui.updateSliderValue("zoom", view.zoom);
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
  // In-flight generation keys, so a repeated view doesn't post duplicate requests.
  const inFlight = new Set<string>();
  // Bumped on every seed change; results tagged with a stale epoch are dropped so an
  // in-flight build from the previous seed can't repopulate the cache.
  let seedEpoch = 0;

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
    seedEpoch++;
    inFlight.clear();
    worker.postMessage({ id: ++reqId, kind: "reSeed", seed });
  };

  // Seed the worker before the first generate (postMessage ordering keeps it first).
  reseedWorker(appState.mapName);

  // The coarse whole-globe map is always drawn underneath (so panning never leaves
  // a gap); zoomed in, a dense local patch is layered on top. Rotation/zoom
  // re-project instantly; a debounced regen swaps in the right patch on settle.
  let globalMap: GlobeMap | null = null;
  let patchMap: GlobeMap | null = null;
  // Total cached maps. With 6 patch levels, zooming straight in builds up to 6 patches
  // at one center; this holds the global base + that stack (plus a little pan slack)
  // so revisited zooms stay warm. The global base is never evicted (see cacheMap).
  const CACHE_CAP = 12;

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
    // Cap covers the view at this level's activation zoom (its widest, most zoomed-out point)
    // plus margin. Tied to lv.aboveZoom (fixed per level) → stable within a band for cache reuse.
    const radiusPx = globeRadiusPx(canvas, lv.aboveZoom);
    const halfAngle =
      Math.asin(
        Math.min(1, (0.5 * Math.hypot(canvas.width, canvas.height)) / radiusPx)
      ) * PATCH_PRELOAD_MARGIN;
    return {
      local: true,
      level,
      center: quatViewCenter(orientation),
      halfAngle,
      points: lv.points,
      extraOctaves: lv.octaves,
    };
  }

  const globalKey = () => `g|${globePointCount(appState.settings.resolution)}`;
  const patchKey = (v: LocalView) => {
    const step = v.halfAngle * RECENTER_FRACTION;
    const q = (n: number) => Math.round(n / step);
    return `l|${v.level}|${q(v.center.x)}|${q(v.center.y)}|${q(v.center.z)}`;
  };

  function cacheMap(key: string, map: GlobeMap): void {
    mapCache.set(key, map);
    // Evict oldest PATCHES only — regenerating the global base is slow.
    while (mapCache.size > CACHE_CAP) {
      let evicted = false;
      for (const k of mapCache.keys()) {
        if (k.startsWith("l|")) {
          mapCache.delete(k);
          evicted = true;
          break;
        }
      }
      if (!evicted) break;
    }
  }

  function ensureMap(eager = false) {
    const view = currentView();
    // Track globe/detail state for the menu auto-toggle in setView (map gestures only).
    lastLocal = view.local;
    const gKey = globalKey();
    const pKey = view.local ? patchKey(view) : null;

    // Render whatever's already cached now (covers the gesture); keep the previous
    // patch if the new one isn't ready yet, so we stay crisp while moving.
    globalMap = mapCache.get(gKey) ?? globalMap;
    patchMap = pKey ? mapCache.get(pKey) ?? patchMap : null;
    scheduleRender();

    const needGlobal = !mapCache.has(gKey) && !inFlight.has(gKey);
    // While moving (eager), defer the heaviest levels to the debounced settle so detail
    // ramps up smoothly without a long mid-gesture generation hitch.
    const deferHeavy = eager && view.local && view.points > MAX_LIVE_POINTS;
    const needPatch =
      pKey !== null &&
      view.local &&
      !mapCache.has(pKey) &&
      !inFlight.has(pKey) &&
      !deferHeavy;
    if (!needGlobal && !needPatch) return;

    const epoch = seedEpoch;

    if (needGlobal) {
      inFlight.add(gKey);
      requestMap({ kind: "global", settings: { ...appState.settings } }).then(
        (map) => {
          inFlight.delete(gKey);
          if (epoch !== seedEpoch) return; // seed changed mid-flight — drop
          cacheMap(gKey, map);
          if (globalKey() === gKey) globalMap = map;
          scheduleRender();
        }
      );
    }

    if (needPatch && pKey && view.local) {
      inFlight.add(pKey);
      requestMap({
        kind: "local",
        center: view.center,
        halfAngle: view.halfAngle,
        points: view.points,
        extraOctaves: view.extraOctaves,
      }).then((map) => {
        inFlight.delete(pKey);
        if (epoch !== seedEpoch) return; // stale
        cacheMap(pKey, map);
        // Only display if the current view still wants this exact patch.
        const cur = currentView();
        if (cur.local && patchKey(cur) === pKey) patchMap = map;
        scheduleRender();
      });
    }
  }

  const debouncedEnsureMap = debounce(() => ensureMap(false), 140);

  // View / setting change: re-render now (cheap), ramp detail up live as the view moves
  // (eager, capped by MAX_LIVE_POINTS), then fill in the heaviest level once it settles.
  function drawMap() {
    scheduleRender();
    ensureMap(true);
    debouncedEnsureMap();
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
    mapCache.clear();
    redraw();
  }

  // Reset the view to the default whole-globe, north-up orientation (the regen reset).
  function resetView() {
    controller.stopMomentum();
    orientation = QUAT_IDENTITY;
    appState.settings.zoom = 0;
    ui.updateSliderValue("zoom", 0);
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
    clearMapCache: () => mapCache.clear(),
    loadMap,
    loadNewMap,
    downloadPNG,
  });
  setToolsCollapsed = menu.setToolsCollapsed;
  setTitle = menu.setTitle;

  // --- Initialize ---
  redraw();
});
