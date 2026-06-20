import { v4 as uuid } from "uuid";
import { AppState } from "./AppState";
import { MAPINATION_FILE_EXTENSION } from "./common/constants";
import type { GlobeMap, Vec3 } from "./common/map";
import {
  isValidSaveFile,
  LOD,
  MAP_DEFAULTS,
  type MapSettings,
} from "./common/settings";
import {
  applyThemeUIColors,
  generateThemeButtonCSS,
} from "./common/themeColors";
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
import { sliderDefs, UIManager } from "./UIManager";

// --- Utility Functions ---
const playEffect = (el: HTMLElement, effect: "bounce" | "spin") => {
  el.classList.remove(effect);
  void el.offsetWidth;
  el.classList.add(effect);
};

const fadeOut = (btn: HTMLButtonElement) => {
  btn.classList.add("clicked");
  requestAnimationFrame(() => {
    btn.classList.add("enable-transition");
    setTimeout(() => {
      btn.classList.remove("clicked");
      const off = (e: { propertyName: string }) => {
        if (e.propertyName === "background-color") {
          btn.classList.remove("enable-transition");
          btn.removeEventListener("transitionend", off);
        }
      };
      btn.addEventListener("transitionend", off);
    }, 222);
  });
};

const downloadFile = (c: string | Blob, fname: string, m: string) => {
  const blob = c instanceof Blob ? c : new Blob([c], { type: m });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fname;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

// --- Setup & State ---
const mapCache = new Map<string, GlobeMap>();

// Level-of-detail. Zoomed out (view radius > the coarsest `aboveDeg`) we draw the
// whole-globe mesh; zoomed in we mesh a cap BIGGER than the view (`capDeg` = preload
// margin so panning is already loaded) from the global Fibonacci point set, layering
// `octaves` of finer detail. `points` is that global density → ~points·capArea cells.
//
// The ladder is DERIVED from the knobs below, not hand-placed, so fidelity stays
// uniform: `points` steps geometrically (×POINT_RATIO) from MIN to MAX — a SMALLER ratio
// packs more, finer-spaced bands across the same zoom range — and each level's activation
// angle is solved so every level ENTERS the screen at the same cell size (anchored by the
// finest level at FINEST_ABOVE_DEG). BAND_SHIFT then nudges every trigger a bit more
// zoomed-in. Cells in view ≈ points·(1−cos halfDeg)/2; holding that constant ⇒ points·(1−
// cos aboveDeg) constant ⇒ every patch is ~the same cell count (~equal gen time).
// All tunable in settings.ts (LOD). Destructured so the ladder math below reads cleanly.
const {
  PATCH_RECENTER,
  MAX_PATCH_POINTS,
  MIN_PATCH_POINTS,
  POINT_RATIO,
  FINEST_ABOVE_DEG,
  BAND_SHIFT,
  CAP_MARGIN,
  MAX_EXTRA_OCTAVES,
  EAGER_MAX_POINTS,
  PNG_MIN_EXPORT_POINTS,
} = LOD;

type PatchLevel = {
  aboveDeg: number;
  capDeg: number;
  points: number;
  octaves: number;
};

/** LOD ladder, coarsest → finest, generated from the constants above. */
function buildPatchLevels(): PatchLevel[] {
  const points: number[] = [];
  for (let p = MAX_PATCH_POINTS; p >= MIN_PATCH_POINTS; p /= POINT_RATIO) {
    points.unshift(p);
  }
  // Cell-size target, anchored by the finest level entering at FINEST_ABOVE_DEG.
  const targetCells =
    (MAX_PATCH_POINTS * (1 - Math.cos((FINEST_ABOVE_DEG * Math.PI) / 180))) / 2;
  return points.map((p, i) => {
    const cosAbove = Math.max(-1, Math.min(1, 1 - (2 * targetCells) / p));
    // BAND_SHIFT pulls every level's trigger a bit more zoomed-in.
    const aboveDeg = (((Math.acos(cosAbove) * 180) / Math.PI) * BAND_SHIFT).toFixed(2);
    return {
      points: p,
      aboveDeg: parseFloat(aboveDeg),
      capDeg: parseFloat((parseFloat(aboveDeg) * CAP_MARGIN).toFixed(2)),
      // Octaves spread evenly from the global mesh (rung 0, 0 extra octaves) up to the finest
      // patch (MAX_EXTRA_OCTAVES). Patch i is rung i+1 of points.length rungs above the global.
      octaves: Math.round((MAX_EXTRA_OCTAVES * (i + 1)) / points.length),
    };
  });
}
const PATCH_LEVELS: PatchLevel[] = buildPatchLevels();
console.log("\nPATCH_LEVELS");
console.table(PATCH_LEVELS);


// Map titles are capped at this length: generated names retry/truncate to fit, and the
// input blocks typing past it.
const MAX_TITLE_LEN = 18;

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

  // UI Elements
  const {
    map: canvas,
    mapTitle,
    regenBtn,
    regenBtnImg,
    northBtn,
    resetSlidersBtn,
    loadTitleBtn,
    loadTitleBtnImg,
    downloadBtn,
    uploadBtn,
    downloadPNGBtn,
    downloadSaveBtn,
    cancelPopupBtn,
  } = ui.getAllElements();
  mapTitle.maxLength = MAX_TITLE_LEN; // block typing past the limit (1b)

  // Shrink the title font (down to a floor) so the title + check never overflow the menu bar.
  const MAX_TITLE_FONT_EM = 2.4;
  const MIN_TITLE_FONT_PX = 12;
  const fitTitleFont = () => {
    const rootPx =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = MAX_TITLE_FONT_EM * rootPx;
    mapTitle.style.fontSize = `${maxPx}px`;
    const avail = mapTitle.clientWidth; // flex-allocated width (no horizontal padding)
    const needed = mapTitle.scrollWidth; // text width at the max font
    if (needed > avail && avail > 0) {
      // Monospace width scales with font size, so one proportional step fits it.
      const px = Math.max(MIN_TITLE_FONT_PX, ((maxPx * avail) / needed) * 0.97);
      mapTitle.style.fontSize = `${px}px`;
    }
  };
  mapTitle.addEventListener("input", fitTitleFont);
  window.addEventListener("resize", fitTitleFont);
  document.fonts?.ready.then(fitTitleFont); // re-fit once the title font has loaded

  // Tools sidebar floats above the map; collapsible any time via the toggle, and auto
  // opened/closed when a MAP zoom gesture crosses globe↔detail (see setView). The toggle glyph
  // points the way it'll move: "<" collapses, ">" opens.
  const toolsToggle = document.getElementById("toolsToggle");
  const setToolsCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("tools-collapsed", collapsed);
    if (toolsToggle) toolsToggle.textContent = collapsed ? ">" : "<";
  };
  toolsToggle?.addEventListener("click", () =>
    setToolsCollapsed(!document.body.classList.contains("tools-collapsed"))
  );

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
    const radiusPx = globeRadiusPx(canvas, appState.settings.zoom);
    // angular radius from the view center to the canvas corner (covers the view)
    const halfDeg =
      (Math.asin(
        Math.min(1, (0.5 * Math.hypot(canvas.width, canvas.height)) / radiusPx)
      ) *
        180) /
      Math.PI;
    // finest level whose band still contains this zoom; -1 → whole globe
    let level = -1;
    for (let i = 0; i < PATCH_LEVELS.length; i++) {
      if (halfDeg < PATCH_LEVELS[i].aboveDeg) level = i;
    }
    if (level < 0) return { local: false };
    const lv = PATCH_LEVELS[level];
    return {
      local: true,
      level,
      center: quatViewCenter(orientation),
      halfAngle: (lv.capDeg * Math.PI) / 180,
      points: lv.points,
      extraOctaves: lv.octaves,
    };
  }

  const globalKey = () => `g|${globePointCount(appState.settings.resolution)}`;
  const patchKey = (v: LocalView) => {
    const step = v.halfAngle * PATCH_RECENTER;
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
    const deferHeavy = eager && view.local && view.points > EAGER_MAX_POINTS;
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
  // (eager, capped by EAGER_MAX_POINTS), then fill in the heaviest level once it settles.
  function drawMap() {
    scheduleRender();
    ensureMap(true);
    debouncedEnsureMap();
  }

  // --- UI Helpers ---
  const drawTitle = (name: string) => {
    mapTitle.value = name;
    fitTitleFont(); // new title → re-fit the font to the menu width
  };

  function redraw(newName?: string) {
    if (newName) {
      appState.mapName = newName;
    }
    drawTitle(appState.mapName);
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
      mapTitle.value = "";
      return;
    }
    resetView();
    loadMap(name);
  }

  // --- Bind Sliders ---
  sliderDefs.forEach((def) => {
    const slider = ui.getSlider(def.key);
    ui.updateSliderValue(def.key, Number(appState.settings[def.key]));
    slider.input.addEventListener("input", () => {
      let v = Number(slider.input.value);
      if (!Number.isFinite(v)) v = Number(MAP_DEFAULTS[def.key]);
      v = Math.max(def.min, Math.min(def.max, v));
      appState.updateSetting(def.key, v as any);
      ui.updateSliderValue(def.key, v);
      drawMap();
    });
  });

  // Theme handling
  ui.themeRadios.forEach((radio) => {
    radio.checked = radio.value === appState.settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        appState.updateSetting("theme", radio.value as MapSettings["theme"]);
        applyThemeUIColors(radio.value as MapSettings["theme"]);
        needle?.recolor();
        drawMap();
      }
    });
  });
  applyThemeUIColors(appState.settings.theme);
  needle?.recolor();

  // --- Button handlers ---
  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    loadNewMap(generateMapName());
  });

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

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);
    sliderDefs.forEach((d) => appState.updateSetting(d.key, MAP_DEFAULTS[d.key]));
    sliderDefs.forEach((def) =>
      ui.updateSliderValue(def.key, Number(appState.settings[def.key]))
    );
    mapCache.clear();
    ensureMap();
  });

  loadTitleBtn.addEventListener("click", () => {
    playEffect(loadTitleBtnImg, "bounce");
    loadNewMap(mapTitle.value.trim());
  });

  mapTitle.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = mapTitle.value.trim();
      if (val.toUpperCase() !== appState.mapName) {
        loadNewMap(val);
        playEffect(loadTitleBtnImg, "bounce");
        setTimeout(() => mapTitle.blur(), 400);
      }
    }
  });

  // --- Download/Upload ---
  const handleDownloadSave = () => {
    const mapTitleText = mapTitle.value || "Untitled Map";
    const json = JSON.stringify(
      {
        seed: appState.mapName,
        mapSettings: { ...appState.settings },
      },
      null,
      2
    );
    downloadFile(
      json,
      `${mapTitleText.replace(/\s+/g, "_")}${MAPINATION_FILE_EXTENSION}`,
      "application/json"
    );
  };

  // Composite a rendered globe canvas under the titled header and download it.
  const downloadGlobePNG = (source: HTMLCanvasElement) => {
    const mapTitleText = mapTitle.value || "Untitled Map";
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

  const handleDownloadPNG = () => {
    const view = currentView();
    // Whole-globe view (or no map yet): export exactly what's on screen.
    if (!view.local || !globalMap) {
      downloadGlobePNG(canvas);
      return;
    }
    // Zoomed in: re-render this patch at the export floor (denser than the live zoom
    // band) onto the live canvas at the on-screen framing, capture it, then restore
    // the live view. Rendering to the main canvas keeps a single GL context (the
    // WebGL path can't read back an offscreen canvas it never drew to). The worker
    // builds the dense patch off-thread.
    const base = globalMap;
    const points = Math.max(view.points, PNG_MIN_EXPORT_POINTS);
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
      downloadGlobePNG(canvas);
      scheduleRender(); // restore the live (normal-density) view
    });
  };

  const onLoadSave = (evt: ProgressEvent<FileReader>) => {
    let saveFile: any;
    try {
      saveFile = JSON.parse(evt.target?.result as string);
    } catch {
      alert("Failed to load map file.");
      return;
    }
    if (saveFile.mapSettings) {
      saveFile.mapSettings = { ...MAP_DEFAULTS, ...saveFile.mapSettings };
    }
    if (!isValidSaveFile(saveFile)) return;
    appState.settings = saveFile.mapSettings;
    ui.themeRadios.forEach(
      (radio) => (radio.checked = radio.value === saveFile.mapSettings.theme)
    );
    applyThemeUIColors(saveFile.mapSettings.theme);
    needle?.recolor();
    loadMap(saveFile.seed);
  };
  const handleUpload = () => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: MAPINATION_FILE_EXTENSION,
    });
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = onLoadSave;
      reader.readAsText(file);
    };
    input.click();
  };

  // --- Popup management ---
  const popupBackdrop = document.getElementById("popupBackdrop");
  const handleCancelPopup = () => {
    if (popupBackdrop) popupBackdrop.classList.remove("show");
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("click", clickHandler);
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") handleCancelPopup();
  };
  const clickHandler = (e: MouseEvent) => {
    if (e.target === popupBackdrop) handleCancelPopup();
  };
  if (popupBackdrop) {
    new MutationObserver((muts) =>
      muts.forEach(
        (m) =>
          m.attributeName === "class" &&
          popupBackdrop.classList.contains("show") &&
          (document.addEventListener("keydown", escHandler),
          popupBackdrop.addEventListener("click", clickHandler))
      )
    ).observe(popupBackdrop, { attributes: true });
  }

  // Download/Upload buttons
  downloadBtn.addEventListener("click", () => {
    playEffect(downloadBtn, "bounce");
    popupBackdrop && popupBackdrop.classList.add("show");
  });
  uploadBtn.addEventListener("click", () => {
    playEffect(uploadBtn, "bounce");
    handleUpload();
  });
  downloadPNGBtn.addEventListener("click", () => {
    handleDownloadPNG();
    handleCancelPopup();
  });
  downloadSaveBtn.addEventListener("click", () => {
    handleDownloadSave();
    handleCancelPopup();
  });
  cancelPopupBtn.addEventListener("click", handleCancelPopup);

  // --- Initialize ---
  redraw();
});
