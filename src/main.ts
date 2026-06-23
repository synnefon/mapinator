import { v4 as uuid } from "uuid";
import { AppState, type MapState } from "./AppState";
import { Quat } from "./common/3DMath";
import type { GlobeMap } from "./common/map";
import { applyTuning, LOD, snapshotParams } from "./common/settings";
import { applyThemeUIColors, generateThemeButtonCSS } from "./common/themeColors";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MAX_TITLE_LEN, setupMenuBar } from "./MenuBar";
import { createCompassNeedle } from "./renderer/compassNeedle";
import { GlobeController } from "./renderer/GlobeController";
import { createLodPipeline, type GenRequest } from "./renderer/LodPipeline";
import { drawPlateArrows } from "./renderer/plateArrows";
import { createGlobeRenderer } from "./renderer/WebGLGlobeRenderer";
import { sliderDefs, UIManager } from "./UIManager";

// --- Setup & State ---

// The LOD ladder + generation pipeline (cache, queue, view→rung math, staleness epoch) live in
// renderer/LodPipeline.ts. main keeps only the zoomed-in PNG export-density floor.
const { MIN_EXPORT_POINTS } = LOD;

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
  // The live view orientation (world→view quaternion), driven by the orbit controls, lives on
  // appState (so it rides along in snapshot/restore) — see appState.orientation.
  // rAF handle for the north-align animation (see orientNorth); any user view change
  // cancels it so a drag/zoom mid-animation takes over cleanly.
  let northAnim: number | null = null;
  // Whole-globe vs zoomed-in, last seen — so the tools auto-toggle only when it flips.
  let lastZoomedIn: boolean | null = null;
  // Filled in by setupMenuBar (below): main calls these for auto-collapse (setView) and to
  // show the current map name in the title input (redraw).
  let setToolsCollapsed: (collapsed: boolean) => void = () => { };
  let setTitle: (name: string) => void = () => { };

  // UI Elements (main keeps the canvas + the north overlay; the rest live in the menu).
  const { map: canvas, plateArrows: arrowCanvas, northBtn } = ui.getAllElements();

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
    } else if (key !== "viewPlates" && sliderKeys.has(key)) {
      // viewPlates is a render-only view flag, not a numeric slider — skip it here (its toggle
      // re-renders directly); the !== narrows key to the numeric slider keys for updateSliderValue.
      ui.updateSliderValue(key, appState.settings[key]);
    }
  });

  // Orbit controls: drag = rotate, wheel/pinch = zoom. Mutates orientation + the
  // zoom setting and redraws; geometry is untouched, so this only re-projects.
  const controller = new GlobeController({
    canvas,
    getView: () => ({ orientation: appState.orientation, zoom: appState.settings.zoom }),
    setView: (view) => {
      if (northAnim !== null) {
        cancelAnimationFrame(northAnim); // a drag/zoom interrupts the north animation
        northAnim = null;
      }
      appState.orientation = view.orientation;
      if (view.zoom !== appState.settings.zoom) {
        appState.setSetting("zoom", view.zoom); // zoom is wheel/pinch-driven (no slider)
      }
      // A map zoom gesture (wheel/pinch) crossing globe↔detail auto-toggles the tools — only on
      // the transition, so manual toggles stick. Slider zoom never calls setView, so dragging
      // the zoom slider won't collapse the menu.
      const zoomedIn = pipeline.view().level > 0;
      if (zoomedIn !== lastZoomedIn) setToolsCollapsed(zoomedIn);
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
      arrowCanvas.width = w; // keep the arrow overlay's bitmap matched to the map's, 1:1
      arrowCanvas.height = h;
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
  // The LOD pipeline (ladder, cache, queue, view→rung math, staleness epoch) is created below,
  // once requestMap exists — see renderer/LodPipeline.ts.

  worker.onmessage = (e: MessageEvent<{ id: number; map: GlobeMap }>) => {
    const resolve = pending.get(e.data.id);
    if (!resolve) return;
    pending.delete(e.data.id);
    resolve(e.data.map);
  };
  worker.onerror = (e) => {
    console.error("map worker error:", e.message);
  };

  const requestMap = (req: GenRequest): Promise<GlobeMap> =>
    new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      worker.postMessage({ id, ...req });
    });

  // The LOD pipeline: it feeds ONE generate job at a time to the worker (requestMap), reads the
  // live view (zoom/orientation/resolution + canvas size), and re-renders via scheduleRender
  // (hoisted below) whenever the base globe or the detail overlay changes.
  const pipeline = createLodPipeline({
    postGenerate: requestMap,
    getView: () => ({
      zoom: appState.settings.zoom,
      orientation: appState.orientation,
      resolution: appState.settings.resolution,
      width: canvas.width,
      height: canvas.height,
    }),
    onReady: scheduleRender,
  });

  const reseedWorker = (seed: string) => {
    pipeline.reset(); // bump the staleness epoch + drop cached maps from the previous seed
    // Config carries the seed + the current resolved generation params (snapshotParams reads the
    // live dials, post-applyTuning). postMessage ordering keeps it ahead of the first generate.
    worker.postMessage({ id: ++reqId, kind: "config", seed, params: snapshotParams() });
  };

  // Seed the worker before the first generate (postMessage ordering keeps it first).
  reseedWorker(appState.mapName);

  function render() {
    // Spin the 3D compass needle to point along north's direction in view space (x right,
    // y up, z toward camera) — a live compass that foreshortens as north tilts in/out and,
    // being a solid, never collapses to nothing when you face a pole.
    if (needle) {
      needle.update(Quat.rotate(appState.orientation, { x: 0, y: 1, z: 0 }));
    }
    const baseMap = pipeline.base();
    const overlay = pipeline.overlay();
    if (!baseMap) return;
    // The globe (rung 0) is the base; an overlaid detail patch (if any) sits on top. When a patch
    // is overlaid, the base skips the cells it hides (its cap), so a zoomed-in view doesn't redraw
    // a full globe under the patch.
    globeRenderer.draw(
      canvas,
      baseMap,
      appState.settings,
      appState.orientation,
      true,
      overlay?.cap
    );
    if (overlay) {
      globeRenderer.draw(canvas, overlay, appState.settings, appState.orientation, false);
    }
    // Plate-motion arrows: a 2D overlay, drawn only with the plate view on (geometry is sampled in
    // the worker; here we just project it to match the active renderer's offset). Otherwise wipe it.
    if ((appState.settings.viewPlates ?? false) && baseMap.arrowPositions.length) {
      drawPlateArrows(
        arrowCanvas,
        baseMap.arrowPositions,
        baseMap.arrowDirections,
        appState.orientation,
        appState.settings.zoom,
        globeRenderer.horizontalOffsetFraction()
      );
    } else {
      arrowCanvas.getContext("2d")?.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
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
    const start = appState.orientation;
    const dot = Math.abs(
      start.x * target.x + start.y * target.y + start.z * target.z + start.w * target.w
    );
    const angle = 2 * Math.acos(Math.min(1, dot)); // rotation between start and target
    if (angle < 1e-4) {
      appState.orientation = target;
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
      appState.orientation = Quat.slerp(start, target, eased);
      render();
      northAnim = t < 1 ? requestAnimationFrame(step) : null;
    };
    northAnim = requestAnimationFrame(step);
  }

  function ensureMap(): void {
    lastZoomedIn = pipeline.view().level > 0; // for the menu auto-collapse (read in setView)
    pipeline.sync(); // queues every uncovered rung (incl. the globe) and re-renders via onReady
  }

  // Apply the current advanced-tuning overrides everywhere, then rebuild. Render dials
  // (sea level, elevation contrast, …) take effect on this thread; generation dials + feature
  // switches go to the worker as a resolved params snapshot. pipeline.reset() discards in-flight
  // maps built with the old tuning, and ensureMap regenerates at the current view.
  function applyAdvancedTuning(): void {
    applyTuning({ ...appState.tuningOverrides }); // render-side dials (sea level, contrast, colours) on this thread
    // Generation dials + features → worker as a params snapshot (no seed change). snapshotParams()
    // reads the dials applyTuning just wrote, plus the live FEATURES.
    worker.postMessage({ id: ++reqId, kind: "config", params: snapshotParams() });
    pipeline.reset();
    ensureMap();
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

  // Switch to the map with this seed/name, keeping the current view. New maps go through
  // loadNewMap; loaded save files go through loadSavedMap.
  function loadMap(name: string) {
    appState.mapName = name; // setter upper-cases it (case-insensitive keys)
    reseedWorker(appState.mapName); // reset() inside drops the old cache + bumps the staleness epoch
    redraw();
  }

  // Load a saved map: restore the full snapshot (settings, tuning, orientation, seed), then push
  // the tuning to the render dials (this thread) and re-config the worker (seed + resolved params)
  // in one go, and do a SINGLE regen at the restored view. ensureMap runs after the epoch bump so
  // its result is kept.
  function loadSavedMap(state: MapState) {
    controller.stopMomentum();
    appState.restore(state);
    applyTuning({ ...appState.tuningOverrides }); // render-side dials (sea level, contrast, colours) on this thread
    reseedWorker(appState.mapName); // worker seed + params + reset() (drops old cache, bumps epoch)
    setTitle(appState.mapName);
    ensureMap();
  }

  // Reset the view to the default whole-globe, north-up orientation (the regen reset).
  function resetView() {
    controller.stopMomentum();
    appState.orientation = Quat.identity;
    appState.setSetting("zoom", 0); // back to whole-globe zoom
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
    if (pipeline.view().level > 0) {
      const n = Quat.rotate(appState.orientation, { x: 0, y: 1, z: 0 }); // north in view space
      target = Quat.normalize(
        Quat.mul(Quat.fromAxisAngle(0, 0, 1, Math.atan2(n.x, n.y)), appState.orientation)
      );
    } else {
      const c = Quat.viewCenter(appState.orientation); // world point currently facing the camera
      const lon = Math.atan2(c.z, c.x); // keep this longitude; level latitude to 0
      target = Quat.fromAxisAngle(0, 1, 0, lon - Math.PI / 2);
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
    const view = pipeline.view();
    const base = pipeline.base();
    // Whole-globe view (or no map yet): export exactly what's on screen.
    if (view.level === 0 || !base) {
      downloadGlobePNG(canvas, title);
      return;
    }
    // Zoomed in: re-render this patch at the export floor (denser than the live zoom
    // band) onto the live canvas at the on-screen framing, capture it, then restore
    // the live view. Rendering to the main canvas keeps a single GL context (the
    // WebGL path can't read back an offscreen canvas it never drew to). The worker
    // builds the dense patch off-thread.
    const points = Math.max(view.points, MIN_EXPORT_POINTS);
    requestMap({
      kind: "generate",
      center: view.center,
      halfAngle: view.halfAngle,
      points,
      extraOctaves: view.extraOctaves,
    }).then((patch) => {
      globeRenderer.draw(
        canvas,
        base,
        appState.settings,
        appState.orientation,
        true,
        patch.cap
      );
      globeRenderer.draw(canvas, patch, appState.settings, appState.orientation, false);
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
    clearMapCache: () => pipeline.reset(),
    loadNewMap,
    loadSavedMap,
    downloadPNG,
    applyAdvancedTuning,
  });
  setToolsCollapsed = menu.setToolsCollapsed;
  setTitle = menu.setTitle;

  // --- Initialize ---
  redraw();
});
