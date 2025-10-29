import { v4 as uuid } from "uuid";
import { AppState } from "./AppState";
import { MAPINATION_FILE_EXTENSION } from "./common/constants";
import type { WorldMap } from "./common/map";
import { printSection } from "./common/printUtils";
import {
  makeRNG,
  randomContinuousChoice,
  weightedRandomChoice,
  type RNG,
} from "./common/random";
import {
  isValidSaveFile,
  MAP_DEFAULTS,
  type MapSettings,
  type NumericSettingKey,
} from "./common/settings";
import {
  applyThemeUIColors,
  generateThemeButtonCSS,
} from "./common/themeColors";
import { debounce, lerp } from "./common/util";
import { MapGenerator } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MapRenderer } from "./renderer/MapRenderer";
import { PanZoomController } from "./renderer/PanZoomController";
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
const mapCache = new Map<string, WorldMap>();
const getCacheKey = (s: MapSettings) =>
  sliderDefs.map((d) => s[d.key]).join("|");

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
  const mapRenderer = new MapRenderer();
  let rng: RNG = makeRNG(appState.mapName);

  // UI Elements
  const {
    map: canvas,
    mapTitle,
    zoomInput,
    zoomValue,
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

  // Pan/Zoom Controller
  const panZoomController = new PanZoomController({
    canvas,
    onRedraw: drawMap,
    getCachedMap: () => mapCache.get(getCacheKey(appState.settings)) ?? null,
    momentum: 0.3,
    onZoomChange: (zoom, scale) => {
      zoomInput.value = String(zoom);
      zoomValue.textContent = scale.toFixed(2);
    },
  });

  // --- Map Rendering ---
  function drawMap() {
    const cacheKey = getCacheKey(appState.settings);
    let cached = mapCache.get(cacheKey);
    if (!cached) {
      cached = mapGenerator.generateMap(appState.settings);
      mapCache.set(cacheKey, cached);
    }
    mapRenderer.drawCellColors(
      canvas,
      cached,
      appState.settings,
      panZoomController.panX,
      panZoomController.panY,
      panZoomController.viewScale
    );
  }

  const debouncedDrawMap = debounce(
    drawMap,
    lerp(0, 5, appState.settings.resolution, 0, 1)
  );

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
    rng = makeRNG(appState.mapName);
    Object.assign(appState.settings, {
      clumpiness: weightedRandomChoice(
        [
          { val: randomContinuousChoice(0.75, 0.95, rng), prob: 0.75 },
          { val: randomContinuousChoice(-0.95, -0.75, rng), prob: 0.25 },
        ],
        rng
      ),
      terrainFrequency: randomContinuousChoice(0.6, 0.8, rng),
      weatherFrequency: randomContinuousChoice(0.4, 0.85, rng),
      rainfall: randomContinuousChoice(0.45, 0.8, rng),
    });
    printSection(
      "MAP SETTINGS",
      ...Object.entries(appState.settings).map(([key, value]) => ({
        key,
        value,
      }))
    );
    drawTitle(appState.mapName);
    drawMap();
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
    panZoomController.resetPan();
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
      debouncedDrawMap();
    });
  });

  // Zoom setup
  zoomInput.value = String(appState.settings.zoom);
  panZoomController.setZoom(appState.settings.zoom);
  zoomValue.textContent = panZoomController.viewScale.toFixed(2);
  zoomInput.addEventListener("input", () => {
    appState.updateSetting("zoom", Number(zoomInput.value));
    panZoomController.setZoom(appState.settings.zoom);
    drawMap();
  });

  // Theme handling
  ui.themeRadios.forEach((radio) => {
    radio.checked = radio.value === appState.settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        appState.updateSetting("theme", radio.value as MapSettings["theme"]);
        applyThemeUIColors(radio.value as MapSettings["theme"]);
        debouncedDrawMap();
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
    panZoomController.resetPan();
    redraw(appState.mapName);
  });

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);
    [...sliderDefs.map((d) => d.key), "zoom"].forEach((k) => {
      appState.updateSetting(
        k as NumericSettingKey,
        MAP_DEFAULTS[k as NumericSettingKey]
      );
    });
    sliderDefs.forEach((def) =>
      ui.updateSliderValue(def.key, Number(appState.settings[def.key]))
    );
    zoomInput.value = String(appState.settings.zoom);
    panZoomController.setZoom(appState.settings.zoom);
    panZoomController.resetPan();
    mapCache.clear();
    drawMap();
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
        mapSettings: { ...appState.settings, zoom: undefined },
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
    if (saveFile.mapSettings) saveFile.mapSettings.zoom = 0;
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
