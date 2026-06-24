import { v4 as uuid } from "uuid";
import { AppState, type MapState } from "./AppState";
import { Quat } from "./common/3DMath";
import type { GlobeMap } from "./common/map";
import { Languages, type Language } from "./common/language";
import { applyTuning, LOD, OCEAN, snapshotParams } from "./common/settings";
import { applyThemeUIColors, generateThemeButtonCSS } from "./common/themeColors";
import { computeMapFeatures, type MapFeatures } from "./mapgen/features";
import { NameGenerator } from "./mapgen/NameGenerator";
import { recommendedWorkerCount, WorkerPool } from "./mapgen/WorkerPool";
import { MAX_TITLE_LEN, setupMenuBar } from "./MenuBar";
import { createCompassNeedle } from "./renderer/compassNeedle";
import { GlobeController } from "./renderer/GlobeController";
import { createLodPipeline, type GenRequest } from "./renderer/LodPipeline";
import { CityMarkers } from "./CityMarkers";
import { CountryLabels } from "./CountryLabels";
import { InfoPopup } from "./InfoPopup";
import { drawCountries } from "./renderer/countryLayer";
import { drawFeatureLabels } from "./renderer/featureLabels";
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
  // A dedicated namer for feature labels: every call passes an explicit per-feature seed (so names
  // are deterministic), which keeps the title namer's stream above untouched.
  const featureNamer = new NameGenerator("features");

  // The map's language: ONE per map, used for both the title and the feature labels (so they match).
  // Picked from the selected languages — all of them by default. Stored on appState + saved in the
  // map state, so a loaded save relabels in its original language.
  const pickMapLanguage = (): Language => {
    const pool = appState.selectedLanguages.length ? appState.selectedLanguages : Languages;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  // Set whenever generateMapName produces a title, so loadNewMap can tell a just-generated name
  // (language already chosen, title built in it) from a typed-in one (needs a fresh language).
  let lastGeneratedName = "";

  // Generate a NEW map title: pick the map's language, store it, and build a title in it — within
  // the title length limit (retry a few times, then truncate as a fallback).
  const generateMapName = (): string => {
    const lang = pickMapLanguage();
    appState.language = lang;
    let name = nameGenerator.generate({ lang });
    for (let i = 0; i < 20 && name.length > MAX_TITLE_LEN; i++) {
      name = nameGenerator.generate({ lang });
    }
    if (name.length > MAX_TITLE_LEN) name = name.slice(0, MAX_TITLE_LEN);
    lastGeneratedName = name;
    return name;
  };

  // Initialize mapName if not already set
  if (!appState.mapName) {
    appState.mapName = generateMapName(); // also picks + stores the map's language
  } else {
    appState.language = pickMapLanguage(); // a seed came from the URL — give its labels a language
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
  const {
    map: canvas,
    plateArrows: arrowCanvas,
    featureLabels: labelCanvas,
    countries: countryCanvas,
    northBtn,
  } = ui.getAllElements();

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
    } else if (
      key !== "viewPlates" &&
      key !== "viewLabels" &&
      key !== "viewCountries" &&
      key !== "viewCities" &&
      key !== "viewCountryColors" &&
      sliderKeys.has(key)
    ) {
      // viewPlates/viewLabels are render-only view flags, not numeric sliders — skip them here (their
      // toggles re-render directly); the !== checks narrow key to the numeric slider keys below.
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
      labelCanvas.width = w; // and the feature-label overlay
      labelCanvas.height = h;
      countryCanvas.width = w; // and the country overlay
      countryCanvas.height = h;
      return true;
    }
    return false;
  };
  resizeCanvas();
  window.addEventListener("resize", () => {
    if (resizeCanvas()) drawMap();
  });

  // --- Map Rendering ---
  // Terrain generation runs in a POOL of Web Workers so heavy meshing/noise never blocks the UI
  // thread AND independent LOD rungs build in parallel; the globe's typed arrays transfer back
  // zero-copy. Rotate/zoom only re-project (reading the cached arrays), so they stay on the main
  // thread. The pool SIZE caps peak generation memory (see WorkerPool / recommendedWorkerCount).
  const pool = new WorkerPool(recommendedWorkerCount());

  const requestMap = (req: GenRequest): Promise<GlobeMap> => pool.generate(req);

  // The LOD pipeline: it feeds generate jobs to the worker pool (up to pool.size at once), reads the
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
    maxInFlight: pool.size, // up to one concurrent generate per worker
  });

  const reseedWorker = (seed: string) => {
    pipeline.reset(); // bump the staleness epoch + drop cached maps from the previous seed
    // Config carries the seed + the current resolved generation params (snapshotParams reads the live
    // dials, post-applyTuning), broadcast to EVERY worker. Per-worker postMessage ordering keeps it
    // ahead of that worker's first generate.
    pool.configure({ seed, params: snapshotParams() });
  };

  // Seed every worker before the first generate (per-worker postMessage ordering keeps it first).
  reseedWorker(appState.mapName);

  // Feature labels are computed once per (base map, sea level, language) and re-projected each
  // frame. Keyed on the base GlobeMap, so a new/regenerated map recomputes automatically; the
  // seaLevel/language guard catches a render-dial change that happened to reuse the same map object.
  type FeatureCacheEntry = { seaLevel: number; language: Language; result: MapFeatures };
  const featureCache = new WeakMap<GlobeMap, FeatureCacheEntry>();

  // Interactive country labels (DOM) + the hover state that drives the territory highlight.
  let hoveredCountry: number | null = null;
  let labelResult: MapFeatures | null = null; // the result the DOM labels were last built from
  let featureEpoch = 0; // bumps when the feature result changes — keys the GPU choropleth colour cache
  // One shared info popup for both countries and cities; it follows its anchor + self-closes (InfoPopup).
  const infoPopup = new InfoPopup();
  const countryLabels = new CountryLabels(canvas.parentElement as HTMLElement, {
    onHover: (index) => {
      hoveredCountry = index;
      drawCountryOverlay(); // repaint just the overlay — no full-globe redraw needed
    },
    popup: infoPopup,
  });
  // Interactive city markers (DOM dots over the globe), revealed by zoom tier; default on.
  const cityMarkers = new CityMarkers(canvas.parentElement as HTMLElement, infoPopup);

  // Redraw the country overlay (hovered territory highlight + dotted borders) from the cached BASE
  // result, always at base-mesh resolution; the live zoom only re-projects it. Deliberately coarse at
  // all zooms: a per-patch (up to millions of cells) classification either froze pan/zoom or hitched on
  // first hover, so we keep the cheap, bounded base mesh. The fill is blocky and bleeds over sub-cell
  // water when deeply zoomed — an accepted tradeoff for a smooth, free overlay.
  function drawCountryOverlay(): void {
    const baseMap = pipeline.base();
    const entry = baseMap ? featureCache.get(baseMap) : undefined;
    if (!baseMap || !entry || !(appState.settings.viewCountries ?? false)) {
      countryCanvas.getContext("2d")?.clearRect(0, 0, countryCanvas.width, countryCanvas.height);
      return;
    }
    const highlight =
      hoveredCountry !== null
        ? { map: baseMap, countryOf: entry.result.countryOf, index: hoveredCountry }
        : null;
    drawCountries(
      countryCanvas,
      entry.result.borders,
      highlight,
      appState.orientation,
      appState.settings.zoom,
      globeRenderer.horizontalOffsetFraction()
    );
  }

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

    const viewLevel = pipeline.view().level;
    const showLabels = appState.settings.viewLabels ?? false;
    const showCountries = appState.settings.viewCountries ?? false;
    const showCities = appState.settings.viewCities ?? false;
    const showCountryColors = appState.settings.viewCountryColors ?? false;
    const clear = (c: HTMLCanvasElement) =>
      c.getContext("2d")?.clearRect(0, 0, c.width, c.height);

    // Labels, country borders, and cities share one feature set (countries drive naming), computed once
    // per (base map, sea level, language) and cached. Resolved BEFORE the globe draw so the choropleth
    // can tint the globe's per-cell colours on the GPU (free per frame).
    let entry: FeatureCacheEntry | null = null;
    if (showLabels || showCountries || showCities || showCountryColors) {
      const seaLevel = OCEAN.SEA_LEVEL.value;
      entry = featureCache.get(baseMap) ?? null;
      if (!entry || entry.seaLevel !== seaLevel || entry.language !== appState.language) {
        entry = {
          seaLevel,
          language: appState.language,
          result: computeMapFeatures(
            baseMap,
            seaLevel,
            appState.language,
            appState.mapName,
            featureNamer,
            appState.selectedLanguages
          ),
        };
        featureCache.set(baseMap, entry);
      }
      // Rebuild the interactive labels/markers when the underlying result changes (new map / dials).
      if (entry.result !== labelResult) {
        labelResult = entry.result;
        featureEpoch++;
        hoveredCountry = null;
        countryLabels.setCountries(entry.result.countries);
        cityMarkers.setCities(entry.result.cities);
      }
    }

    // The choropleth tints the BASE globe's per-cell colours on the GPU. The detail patch has no
    // per-cell country data, so it stays untinted when zoomed in (an accepted limit of the GPU path).
    const choropleth =
      showCountryColors && entry
        ? { map: baseMap, countryOf: entry.result.countryOf, countryColors: entry.result.countryColors, key: `${featureEpoch}` }
        : undefined;

    // The globe (rung 0) is the base; an overlaid detail patch (if any) sits on top. When a patch is
    // overlaid, the base skips the cells it hides (its cap), so a zoomed-in view doesn't redraw a full
    // globe under the patch.
    globeRenderer.draw(canvas, baseMap, appState.settings, appState.orientation, true, overlay?.cap, choropleth);
    if (overlay) {
      // Pass the same tint so the detail patch samples the country texture too (follows at any zoom).
      globeRenderer.draw(canvas, overlay, appState.settings, appState.orientation, false, undefined, choropleth);
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

    // 2D / DOM overlays over the globe: feature labels, country borders + names, city markers.
    if (entry) {
      const offset = globeRenderer.horizontalOffsetFraction();
      if (showLabels) {
        drawFeatureLabels(
          labelCanvas,
          entry.result.features,
          appState.orientation,
          appState.settings.zoom,
          offset,
          viewLevel
        );
      } else clear(labelCanvas);
      if (showCountries) {
        drawCountryOverlay();
        countryLabels.setVisible(true);
        countryLabels.update(canvas, entry.result.countries, appState.orientation, appState.settings.zoom, offset);
      } else {
        clear(countryCanvas);
        countryLabels.setVisible(false);
      }
      if (showCities) {
        cityMarkers.setVisible(true);
        cityMarkers.update(canvas, entry.result.cities, appState.orientation, appState.settings.zoom, offset, viewLevel);
      } else {
        cityMarkers.setVisible(false);
      }
    } else {
      clear(labelCanvas);
      clear(countryCanvas);
      countryLabels.setVisible(false);
      cityMarkers.setVisible(false);
    }
    // The shared popup follows its anchor + closes itself when that anchor leaves view (behind the limb,
    // below its reveal level, or when its layer is off). Driven every frame so a layer toggle dismisses it.
    const popupSrc = infoPopup.source();
    if (popupSrc) {
      const layerVisible = popupSrc === "city" ? showCities : showCountries;
      infoPopup.update(
        canvas,
        appState.orientation,
        appState.settings.zoom,
        globeRenderer.horizontalOffsetFraction(),
        viewLevel,
        layerVisible
      );
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
    pool.configure({ params: snapshotParams() });
    pipeline.reset();
    ensureMap();
  }

  // Generation is throttled during continuous pan/zoom: re-projecting cached maps stays per-frame
  // smooth (scheduleRender), but QUEUEING new detail every frame floods the worker pool with patches
  // for centres that go stale before they finish — each landing forces a GPU upload, the cause of pan
  // jank. So sync at most once per GEN_SYNC_MS, with a trailing call so the resting view gets detail.
  const GEN_SYNC_MS = 150;
  let lastSyncMs = 0;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSync(): void {
    if (syncTimer !== null) return; // a trailing sync is already pending
    const since = performance.now() - lastSyncMs;
    if (since >= GEN_SYNC_MS) {
      lastSyncMs = performance.now();
      pipeline.sync();
    } else {
      syncTimer = setTimeout(() => {
        syncTimer = null;
        lastSyncMs = performance.now();
        pipeline.sync();
      }, GEN_SYNC_MS - since);
    }
  }

  // View change (pan/zoom/momentum): re-render now (cheap, cached re-projection) and throttle the
  // generation sync (above) so a continuous gesture stays smooth instead of flooding the pool every
  // frame. Explicit regen (seed/tuning/load) goes through ensureMap for an immediate sync.
  function drawMap(): void {
    scheduleRender();
    lastZoomedIn = pipeline.view().level > 0; // cheap; keep current for the menu auto-collapse
    scheduleSync();
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
    // A typed-in name has no generation language — give it (and its labels) a freshly picked one.
    // A just-generated name already had its language chosen by generateMapName; keep that one.
    if (name !== lastGeneratedName) appState.language = pickMapLanguage();
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
