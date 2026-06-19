import { v4 as uuid } from "uuid";
import { AppState } from "./AppState";
import { MAPINATION_FILE_EXTENSION } from "./common/constants";
import type { GlobeMap, Vec3 } from "./common/map";
import { printSection } from "./common/printUtils";
import {
  isValidSaveFile,
  MAP_DEFAULTS,
  type MapSettings,
} from "./common/settings";
import {
  applyThemeUIColors,
  generateThemeButtonCSS,
} from "./common/themeColors";
import { debounce } from "./common/util";
import { globePointCount, MapGenerator } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { GlobeController } from "./renderer/GlobeController";
import { GlobeRenderer, globeRadiusPx } from "./renderer/GlobeRenderer";
import { QUAT_IDENTITY, quatViewCenter, type Quat } from "./common/rotation";
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

// Level-of-detail: zoomed out (visible cap > ~38°) we draw the whole-globe mesh;
// zoomed in we mesh a cap BIGGER than the view (`capDeg` = preload margin so
// panning is already loaded) from the global point set, layering `octaves` of
// finer detail. 5 levels (global + 4 patch) span the zoom range. `points` = global
// Fibonacci density → ~points×capArea cells per patch (~1 KB each; tune for memory).
const PATCH_RECENTER = 0.12; // regen when the view center moves ~12% of the cap
const PATCH_LEVELS = [
  { aboveDeg: 38, capDeg: 60, points: 110_000, octaves: 1 },
  { aboveDeg: 22, capDeg: 32, points: 320_000, octaves: 2 },
  { aboveDeg: 12, capDeg: 17, points: 960_000, octaves: 3 },
  { aboveDeg: 6.5, capDeg: 10, points: 2_500_000, octaves: 4 }, // max-zoom fidelity
] as const;

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
        img.style.maskImage = img.style.webkitMaskImage = `url(${src})`;
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      }
    });

  // App objects & state
  const appState = new AppState();
  const ui = new UIManager();
  const nameGenerator = new NameGenerator(uuid());
  const generateMapName = () =>
    nameGenerator.generate({
      lang: appState.selectedLanguages.length
        ? appState.selectedLanguages[
            Math.floor(Math.random() * appState.selectedLanguages.length)
          ]
        : undefined,
    });

  // Initialize mapName if not already set
  if (!appState.mapName) {
    appState.mapName = generateMapName();
  }

  const mapGenerator = new MapGenerator(appState.mapName);
  const globeRenderer = new GlobeRenderer();
  // Live view orientation (world→view quaternion), driven by the orbit controls;
  // reset on regen. Replaced wholesale by setView (not mutated in place).
  let orientation: Quat = QUAT_IDENTITY;

  // UI Elements
  const {
    map: canvas,
    mapTitle,
    regenBtn,
    regenBtnImg,
    resetSlidersBtn,
    loadTitleBtn,
    loadTitleBtnImg,
    downloadBtn,
    uploadBtn,
    downloadPNGBtn,
    downloadSaveBtn,
    cancelPopupBtn,
  } = ui.getAllElements();

  // Orbit controls: drag = rotate, wheel/pinch = zoom. Mutates orientation + the
  // scale setting and redraws; geometry is untouched, so this only re-projects.
  new GlobeController({
    canvas,
    getView: () => ({ orientation, scale: appState.settings.scale }),
    setView: (view) => {
      orientation = view.orientation;
      if (view.scale !== appState.settings.scale) {
        appState.updateSetting("scale", view.scale);
        ui.updateSliderValue("scale", view.scale);
      }
      drawMap();
    },
  });

  // --- Map Rendering ---
  const mapLoader = document.getElementById("mapLoader");
  const setLoading = (on: boolean) => {
    mapLoader?.classList.toggle("hidden", !on);
  }

  // The coarse whole-globe map is always drawn underneath (so panning never leaves
  // a gap); zoomed in, a dense local patch is layered on top. Rotation/zoom
  // re-project instantly; a debounced regen swaps in the right patch on settle.
  let globalMap: GlobeMap | null = null;
  let patchMap: GlobeMap | null = null;
  // Total cached maps. Patches run tens of thousands of cells (~1 KB each), so
  // this bounds patch memory; the global base is never evicted (see getOrGenerate).
  const CACHE_CAP = 8;

  function render() {
    if (!globalMap) return;
    globeRenderer.draw(canvas, globalMap, appState.settings, orientation, true);
    if (patchMap) {
      globeRenderer.draw(canvas, patchMap, appState.settings, orientation, false);
    }
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
    const radiusPx = globeRadiusPx(canvas, appState.settings.scale);
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

  function getOrGenerate(key: string, generate: () => GlobeMap): GlobeMap {
    const existing = mapCache.get(key);
    if (existing) return existing;
    const map = generate();
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
    return map;
  }

  function ensureMap() {
    const view = currentView();
    const gKey = globalKey();
    const pKey = view.local ? patchKey(view) : null;

    // Render whatever's already cached now (covers the gesture); keep the previous
    // patch if the new one isn't ready yet, so we stay crisp while moving.
    globalMap = mapCache.get(gKey) ?? globalMap;
    patchMap = pKey ? mapCache.get(pKey) ?? patchMap : null;
    render();

    const needGlobal = !mapCache.has(gKey);
    if (!needGlobal && (!pKey || mapCache.has(pKey))) return;
    // Loader ONLY for a fresh whole-globe build (new seed / first load /
    // resolution change). Patch regen on pan/zoom stays silent.
    if (needGlobal) setLoading(true);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        globalMap = getOrGenerate(gKey, () =>
          mapGenerator.generateMap(appState.settings)
        );
        patchMap =
          view.local && pKey
            ? getOrGenerate(pKey, () =>
                mapGenerator.generateLocalMap(
                  view.center,
                  view.halfAngle,
                  view.points,
                  view.extraOctaves
                )
              )
            : null;
        if (needGlobal) setLoading(false);
        render();
      })
    );
  }

  const debouncedEnsureMap = debounce(ensureMap, 140);

  // View / setting change: re-render the current globe now (cheap), then resolve
  // the correct detail/geometry once the gesture settles.
  function drawMap() {
    render();
    debouncedEnsureMap();
  }

  // --- UI Helpers ---
  const updateButtonPosition = () => {
    loadTitleBtn.style.transform = `translate(${
      mapTitle.offsetWidth / 2 + 16
    }px, -50%)`;
  };
  const drawTitle = (name: string) => {
    mapTitle.value = name;
    setTimeout(updateButtonPosition, 0);
  };

  function redraw(newName?: string) {
    if (newName) {
      appState.mapName = newName;
    }
    printSection(
      "MAP SETTINGS",
      ...Object.entries(appState.settings).map(([key, value]) => ({
        key,
        value,
      }))
    );
    drawTitle(appState.mapName);
    ensureMap();
  }

  function loadMap(name: string) {
    if (!name.trim()) {
      alert("Please enter the name of a map to load in");
      appState.mapName = "";
      mapTitle.value = "";
      return;
    }
    appState.mapName = name;
    mapGenerator.reSeed(name);
    mapCache.clear();
    redraw(name);
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
        drawMap();
      }
    });
  });
  applyThemeUIColors(appState.settings.theme);

  // --- Button handlers ---
  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    appState.mapName = generateMapName();
    mapGenerator.reSeed(appState.mapName);
    mapCache.clear();
    orientation = QUAT_IDENTITY;
    appState.settings.scale = 1;
    ui.updateSliderValue("scale", 1);
    redraw(appState.mapName);
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
    loadMap(mapTitle.value.trim());
  });

  mapTitle.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = mapTitle.value.trim();
      if (val !== appState.mapName) {
        loadMap(val);
        playEffect(loadTitleBtnImg, "bounce");
        setTimeout(() => mapTitle.blur(), 400);
      }
    }
  });
  mapTitle.addEventListener("input", updateButtonPosition);

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

  const handleDownloadPNG = () => {
    const mapTitleText = mapTitle.value || "Untitled Map";
    const exportCanvas = Object.assign(document.createElement("canvas"), {
      width: canvas.width,
      height: canvas.height + 60,
    });
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#dedede";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(canvas, 0, 60);
    ctx.font = "bold 36px 'Roboto Mono', monospace";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.fillText(mapTitleText, exportCanvas.width / 2, 40);
    const dataUrl = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `${mapTitleText.replace(/\s+/g, "_")}.png`;
    link.href = dataUrl;
    link.click();
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
  setTimeout(updateButtonPosition, 100);
});
