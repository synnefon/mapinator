import { v4 as uuid } from "uuid";
import { Languages, type Language } from "./common/language";
import type { WorldMap } from "./common/map";
import {
  isMapSettings,
  MAP_DEFAULTS,
  type MapSettings,
} from "./common/settings";
import { debounce, lerp } from "./common/util";
import { MapGenerator } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MapRenderer } from "./renderer/MapRenderer";
import { PanZoomController } from "./renderer/PanZoomController";
import { UIManager, type NumKey, type SliderDef, sliderDefs } from "./UIManager";

// === UTILITY FUNCTIONS ===

const playEffect = (element: HTMLElement, effect: "bounce" | "spin") => {
  element.classList.remove(effect);
  void element.offsetWidth; // reflow so animation restarts
  element.classList.add(effect);
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

const downloadFile = (content: string | Blob, filename: string, mimeType: string) => {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

// === TYPES AND CONSTANTS ===

const SLIDER_KEYS = sliderDefs.map((d) => d.key) as readonly NumKey[];
const URL_NUM_KEYS = [...SLIDER_KEYS, "zoom"] as const;
const NUMERIC_SETTING_KEYS = [...URL_NUM_KEYS, "jitter"] as const;

type NumericSettingKey = (typeof NUMERIC_SETTING_KEYS)[number];

const mapCache = new Map<string, WorldMap>();
const getCacheKey = (s: MapSettings) => SLIDER_KEYS.map((k) => s[k]).join("|");

// === APPLICATION STATE ===
class AppState {
  private _settings: Pick<MapSettings, NumericSettingKey> & { theme: MapSettings["theme"] };
  private _selectedLanguages: Language[] = [...Languages];
  private _mapName: string;
  private _syncingFreq = false;

  constructor() {
    const url = new URL(window.location.href);
    const urlParams = url.searchParams;
    
    const numFromUrl = (k: keyof MapSettings, d: number) =>
      parseFloat(urlParams.get(String(k)) ?? String(d));

    const numericSettings = NUMERIC_SETTING_KEYS.reduce((acc, k) => {
      (acc as any)[k] = numFromUrl(k, MAP_DEFAULTS[k]);
      return acc;
    }, {} as Pick<MapSettings, NumericSettingKey>);

    this._settings = {
      ...numericSettings,
      theme: (urlParams.get("theme") as MapSettings["theme"]) ?? MAP_DEFAULTS.theme,
    };

    const urlMapName = urlParams.get("name") || urlParams.get("seed");
    this._mapName = urlMapName || "";
  }

  get settings() { return this._settings; }
  get selectedLanguages() { return this._selectedLanguages; }
  get mapName() { return this._mapName; }
  get syncingFreq() { return this._syncingFreq; }

  set settings(value) { this._settings = value; }
  set selectedLanguages(value) { this._selectedLanguages = value; }
  set mapName(value) { this._mapName = value; }
  set syncingFreq(value) { this._syncingFreq = value; }

  updateSetting<K extends keyof typeof this._settings>(key: K, value: typeof this._settings[K]) {
    this._settings[key] = value;
  }
}


document.addEventListener("DOMContentLoaded", () => {
  // === INITIALIZATION ===
  const appState = new AppState();
  const ui = new UIManager();
  const nameGenerator = new NameGenerator(uuid());
  const mapGenerator = new MapGenerator(appState.mapName || nameGenerator.generate());
  const mapRenderer = new MapRenderer();

  // === CORE FUNCTIONALITY ===
  const elements = ui.getAllElements();
  const canvas = elements.map;
  const mapTitle = elements.mapTitle;
  const zoomInput = elements.zoom;
  const zoomLabel = elements.zoomValue;

  // === MAP RENDERING ===
  const drawMap = () => {
    const cacheKey = getCacheKey(appState.settings);
    let cachedMap = mapCache.get(cacheKey);
    if (!cachedMap) {
      cachedMap = mapGenerator.generateMap(appState.settings);
      mapCache.set(cacheKey, cachedMap);
    }
    mapRenderer.drawCellColors(
      canvas,
      cachedMap,
      appState.settings,
      panZoomController.panX,
      panZoomController.panY,
      panZoomController.viewScale
    );
  };

  const debouncedDrawMap = debounce(
    drawMap,
    lerp(0, 5, appState.settings.resolution, 0, 1)
  );

  // === UI HELPERS ===
  const updateButtonPosition = () => {
    const titleWidth = mapTitle.offsetWidth;
    const loadTitleBtn = elements.loadTitleBtn;
    loadTitleBtn.style.transform = `translate(${titleWidth / 2 + 16}px, -50%)`;
  };

  const generateMapName = () => {
    return nameGenerator.generate({
      lang: appState.selectedLanguages.length === 0
        ? undefined
        : appState.selectedLanguages[Math.floor(Math.random() * appState.selectedLanguages.length)]
    });
  };

  const drawTitle = (name?: string) => {
    const finalName = name && name.trim() ? name : generateMapName();
    mapTitle.value = finalName;
    setTimeout(updateButtonPosition, 0);
  };

  const redraw = () => {
    drawTitle(appState.mapName);
    drawMap();
  };

  const loadMap = (name: string) => {
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
    redraw();
  };

  // === PAN/ZOOM CONTROLLER ===
  const panZoomController = new PanZoomController({
    canvas,
    onRedraw: drawMap,
    getCachedMap: () => mapCache.get(getCacheKey(appState.settings)) ?? null,
    momentum: 0.3,
    onZoomChange: (zoom, viewScale) => {
      zoomInput.value = String(zoom);
      zoomLabel.textContent = viewScale.toFixed(2);
    },
  });

  // === SLIDER MANAGEMENT ===
  const syncFreq = (srcKey: "terrainFrequency" | "weatherFrequency", v: number) => {
    if (!ui.lockFrequencies.checked || appState.syncingFreq) return;

    appState.syncingFreq = true;
    const dstKey = srcKey === "terrainFrequency" ? "weatherFrequency" : "terrainFrequency";

    appState.updateSetting(dstKey, v as any);
    ui.updateSliderValue(dstKey, v);
    debouncedDrawMap();
    appState.syncingFreq = false;
  };

  const bindSlider = (def: SliderDef) => {
    const slider = ui.getSlider(def.key);
    const init = Number(appState.settings[def.key]);
    
    ui.updateSliderValue(def.key, init);

    slider.input.addEventListener("input", () => {
      let v = Number(slider.input.value);
      if (!Number.isFinite(v)) v = Number(MAP_DEFAULTS[def.key]);

      v = Math.max(def.min, Math.min(def.max, v));
      appState.updateSetting(def.key, v as any);
      ui.updateSliderValue(def.key, v);
      debouncedDrawMap();
    });
  };

  // Bind all sliders
  sliderDefs.forEach(bindSlider);

  // Frequency sync handlers
  ui.getSlider("terrainFrequency").input.addEventListener("input", () => {
    const v = Number(ui.getSlider("terrainFrequency").input.value);
    syncFreq("terrainFrequency", v);
  });

  ui.getSlider("weatherFrequency").input.addEventListener("input", () => {
    const v = Number(ui.getSlider("weatherFrequency").input.value);
    syncFreq("weatherFrequency", v);
  });

  // Initialize zoom
  zoomInput.value = String(appState.settings.zoom);
  panZoomController.setZoom(appState.settings.zoom);
  zoomLabel.textContent = panZoomController.viewScale.toFixed(2);
  zoomInput.addEventListener("input", () => {
    appState.updateSetting("zoom", Number(zoomInput.value));
    panZoomController.setZoom(appState.settings.zoom);
    drawMap();
  });

  // === THEME MANAGEMENT ===
  ui.themeRadios.forEach((radio) => {
    radio.checked = radio.value === appState.settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        appState.updateSetting("theme", radio.value as MapSettings["theme"]);
        debouncedDrawMap();
      }
    });
  });

  // === LANGUAGE MANAGEMENT ===
  const getCategoryLanguages = (category: string) =>
    Array.from(ui.languageCheckboxes).filter((cb) => {
      const parent = cb.closest(".language-category");
      const catCb = parent?.querySelector<HTMLInputElement>(".category-checkbox");
      return catCb?.dataset.category === category;
    });

  const updateCategoryCheckbox = (categoryCheckbox: HTMLInputElement) => {
    const langs = getCategoryLanguages(categoryCheckbox.dataset.category ?? "");
    const all = langs.every((cb) => cb.checked);
    const none = langs.every((cb) => !cb.checked);
    categoryCheckbox.checked = all;
    categoryCheckbox.indeterminate = !all && !none;
  };

  const updateSelectedLanguages = () => {
    appState.selectedLanguages = Array.from(ui.languageCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value as Language);
    
    const toggleAllBtn = elements.toggleAllLanguages;
    const allChecked = Array.from(ui.languageCheckboxes).every((cb) => cb.checked);
    toggleAllBtn.textContent = allChecked ? "deselect all" : "select all";
  };

  // Wire category checkboxes
  ui.categoryCheckboxes.forEach((catCb) => {
    catCb.addEventListener("change", () => {
      getCategoryLanguages(catCb.dataset.category ?? "").forEach(
        (cb) => (cb.checked = catCb.checked)
      );
      updateSelectedLanguages();
    });
  });

  // Wire individual language checkboxes
  ui.languageCheckboxes.forEach((cb) => {
    cb.checked = appState.selectedLanguages.includes(cb.value as Language);
    cb.addEventListener("change", () => {
      updateSelectedLanguages();
      const parent = cb.closest(".language-category");
      const catCb = parent?.querySelector<HTMLInputElement>(".category-checkbox");
      if (catCb) updateCategoryCheckbox(catCb);
    });
  });

  // Initialize category states
  ui.categoryCheckboxes.forEach(updateCategoryCheckbox as any);
  updateSelectedLanguages();

  // Toggle-all button
  elements.toggleAllLanguages.addEventListener("click", () => {
    const all = Array.from(ui.languageCheckboxes).every((cb) => cb.checked);
    ui.languageCheckboxes.forEach((cb) => (cb.checked = !all));
    ui.categoryCheckboxes.forEach((cb) => {
      cb.checked = !all;
      cb.indeterminate = false;
    });
    updateSelectedLanguages();
  });

  // === BUTTON EVENT HANDLERS ===
  const regenBtn = elements.regen;
  const regenBtnImg = elements.regenBtnImg;
  const resetSlidersBtn = elements.resetSliders;
  const loadTitleBtn = elements.loadTitleBtn;
  const loadTitleBtnImg = elements.loadTitleBtnImg;
  const downloadBtn = elements.download;
  const uploadBtn = elements.upload;
  const downloadPNGBtn = elements.downloadPNG;
  const downloadSaveBtn = elements.downloadSave;
  const cancelPopupBtn = elements.cancelPopup;

  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    appState.mapName = generateMapName();
    mapGenerator.reSeed(appState.mapName);
    mapCache.clear();
    panZoomController.resetPan();
    redraw();
  });

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);
    ui.lockFrequencies.checked = true;

    // Reset settings to defaults
    URL_NUM_KEYS.forEach((k) => {
      appState.updateSetting(k, MAP_DEFAULTS[k] as any);
    });

    // Sync UI for sliders
    SLIDER_KEYS.forEach((k) => {
      const v = Number(appState.settings[k]);
      ui.updateSliderValue(k, v);
    });

    // Sync zoom separately
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
      if (mapTitle.value.trim() !== appState.mapName) {
        loadMap(mapTitle.value.trim());
        playEffect(loadTitleBtnImg, "bounce");
        setTimeout(() => mapTitle.blur(), 400); // Wait for bounce before blurring
      }
    }
  });

  mapTitle.addEventListener("input", updateButtonPosition);

  // === DOWNLOAD/UPLOAD FUNCTIONALITY ===
  const handleDownloadSave = () => {
    const mapTitleText = mapTitle.value || "Untitled Map";
    const data = {
      seed: appState.mapName,
      mapSettings: {
        ...appState.settings,
        zoom: undefined, // Exclude zoom explicitly
      },
    };
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${mapTitleText.replace(/\s+/g, "_")}.mapination`, "application/json");
  };

  const handleDownloadPNG = () => {
    const mapTitleText = mapTitle.value || "Untitled Map";
    const exportCanvas = document.createElement("canvas");
    const padding = 60;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + padding;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#dedede";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    ctx.drawImage(canvas, 0, padding);

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
    let json: any;
    try {
      json = JSON.parse(evt.target?.result as string);
    } catch {
      alert("Failed to load map file.");
      return;
    }
    if (!json.mapSettings) {
      alert("Invalid map file format.");
      return;
    }

    const mapSettings = {
      ...json.mapSettings,
      zoom: 0,
    };
    if (!isMapSettings(mapSettings)) {
      alert("Invalid map settings in file.");
      return;
    }

    appState.settings = mapSettings;
    ui.themeRadios.forEach((radio) => {
      radio.checked = radio.value === mapSettings.theme;
    });
    loadMap(json.seed);
  };

  const handleUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".mapination,application/json";
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = onLoadSave;
      reader.readAsText(file);
    };
    input.click();
    redraw();
  };

  // Popup management
  const popupBackdrop = document.getElementById("popupBackdrop");
  const handleCancelPopup = () => {
    if (popupBackdrop) {
      popupBackdrop.classList.remove("show");
    }
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("click", clickHandler);
  };

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancelPopup();
    }
  };

  const clickHandler = (e: MouseEvent) => {
    if (e.target === popupBackdrop) handleCancelPopup();
  };

  if (popupBackdrop) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.attributeName === "class" &&
          popupBackdrop.classList.contains("show")
        ) {
          document.addEventListener("keydown", escHandler);
          popupBackdrop.addEventListener("click", clickHandler);
        }
      });
    });
    observer.observe(popupBackdrop, { attributes: true });
  }

  // Download/Upload button handlers
  downloadBtn.addEventListener("click", () => {
    playEffect(downloadBtn, "bounce");
    if (popupBackdrop) {
      popupBackdrop.classList.add("show");
    }
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

  // === INITIALIZATION ===
  redraw();
  setTimeout(updateButtonPosition, 100);
});
