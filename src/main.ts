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

const fetchElement = <T extends HTMLElement>(id: string): T => {
  const elem = document.getElementById(id) as T | null;
  if (!elem) {
    alert(`UI init failed. Missing #${id}`);
    throw new Error(`UI init failed. Missing #${id}`);
  }
  return elem;
};

const mapCache = new Map<string, WorldMap>();

// Numeric sliders we want to bind in a uniform way.
type NumKey =
  | "resolution"
  | "rainfall"
  | "seaLevel"
  | "clumpiness"
  | "elevationContrast"
  | "moistureContrast"
  | "terrainFrequency"
  | "weatherFrequency";

// Slider def now carries numericity + formatting
type SliderDef = {
  key: NumKey;
  idBase: string; // input id; label is `${idBase}Value`
  min: number;
  max: number;
  step: number;
  bound?: string;
};

// idBase is both the input id and label id with "Value" suffix.
const sliderDefs: readonly SliderDef[] = [
  { key: "resolution", idBase: "resolution", min: 0, max: 1, step: 0.01 },
  { key: "rainfall", idBase: "rainfall", min: 0, max: 1, step: 0.01 },
  { key: "seaLevel", idBase: "seaLevel", min: 0, max: 1, step: 0.01 },
  { key: "clumpiness", idBase: "clumpiness", min: -1, max: 1, step: 0.01 },
  {
    key: "elevationContrast",
    idBase: "elevationContrast",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "moistureContrast",
    idBase: "moistureContrast",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "terrainFrequency",
    idBase: "terrainFrequency",
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: "weatherFrequency",
    idBase: "weatherFrequency",
    min: 0,
    max: 1,
    step: 0.01,
  },
];

const SLIDER_KEYS = sliderDefs.map((d) => d.key) as readonly NumKey[];
const URL_NUM_KEYS = [...SLIDER_KEYS, "zoom"] as const;

const getCacheKey = (s: MapSettings) => SLIDER_KEYS.map((k) => s[k]).join("|");

document.addEventListener("DOMContentLoaded", () => {
  // --- URL helpers
  const url = new URL(window.location.href);
  const urlParams = url.searchParams;
  const numFromUrl = (k: keyof MapSettings, d: number) =>
    parseFloat(urlParams.get(String(k)) ?? String(d));

  const lockFrequencies = (() => {
    const el = document.getElementById(
      "lock-frequencies"
    ) as HTMLInputElement | null;
    return (
      el ?? Object.assign(document.createElement("input"), { checked: true })
    ); // default true if missing
  })();

  let syncingFreq = false; // guard to avoid loops

  const syncFreq = (
    srcKey: "terrainFrequency" | "weatherFrequency",
    v: number
  ) => {
    if (!lockFrequencies.checked || syncingFreq) return;

    syncingFreq = true;

    const dstKey =
      srcKey === "terrainFrequency" ? "weatherFrequency" : "terrainFrequency";

    // Update settings
    settings[dstKey] = v as any;

    // Update UI label + input without triggering input handlers
    const dst = bound[dstKey];
    dst.input.value = String(v);
    dst.label.textContent = v.toFixed(dst.decimals);

    debouncedDrawMap();

    syncingFreq = false;
  };

  // All numeric settings to load from URL or defaults
  const NUMERIC_SETTING_KEYS = [...URL_NUM_KEYS, "jitter"] as const;
  type NumericSettingKey = (typeof NUMERIC_SETTING_KEYS)[number];

  const numericSettings = NUMERIC_SETTING_KEYS.reduce((acc, k) => {
    (acc as any)[k] = numFromUrl(k, MAP_DEFAULTS[k]); // safe: both number
    return acc;
  }, {} as Pick<MapSettings, NumericSettingKey>);

  let settings: Pick<MapSettings, NumericSettingKey> & {
    theme: MapSettings["theme"];
  } = {
    ...numericSettings,
    theme:
      (urlParams.get("theme") as MapSettings["theme"]) ?? MAP_DEFAULTS.theme,
  };

  const urlMapName = urlParams.get("name") || urlParams.get("seed");
  const nameGenerator = new NameGenerator(`${Date.now()}`);
  let selectedLanguages: Language[] = [...Languages];
  let mapName = urlMapName || nameGenerator.generate();

  // --- Core objects
  const mapGenerator = new MapGenerator(mapName);
  const mapRenderer = new MapRenderer();

  // --- Elements
  const canvas = fetchElement<HTMLCanvasElement>("map");
  const regenBtn = fetchElement<HTMLButtonElement>("regen");
  const regenBtnImg = fetchElement<HTMLImageElement>("regen-btn-img");
  const resetSlidersBtn = fetchElement<HTMLButtonElement>("reset-sliders");
  const zoomInput = fetchElement<HTMLInputElement>("zoom");
  const zoomLabel = fetchElement<HTMLSpanElement>("zoomValue");

  const mapTitle = fetchElement<HTMLInputElement>("map-title");
  const loadTitleBtn = fetchElement<HTMLButtonElement>("load-title-btn");
  const loadTitleBtnImg = fetchElement<HTMLImageElement>("load-title-btn-img");
  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  const uploadBtn = fetchElement<HTMLButtonElement>("upload");
  const downloadPNGBtn = fetchElement<HTMLButtonElement>("downloadPNG");
  const downloadSaveBtn = fetchElement<HTMLButtonElement>("downloadSave");
  const cancelPopupBtn = fetchElement<HTMLButtonElement>("cancelPopup");

  const themeRadios =
    document.querySelectorAll<HTMLInputElement>(".theme-radio");
  const languageCheckboxes =
    document.querySelectorAll<HTMLInputElement>(".language-checkbox");
  const categoryCheckboxes =
    document.querySelectorAll<HTMLInputElement>(".category-checkbox");
  const toggleAllLanguagesBtn = fetchElement<HTMLButtonElement>(
    "toggle-all-languages"
  );

  // --- Renderers
  const drawMap = () => {
    const cacheKey = getCacheKey(settings);
    let cachedMap = mapCache.get(cacheKey);
    if (!cachedMap) {
      cachedMap = mapGenerator.generateMap(settings);
      mapCache.set(cacheKey, cachedMap);
    }
    mapRenderer.drawCellColors(
      canvas,
      cachedMap,
      settings,
      panZoomController.panX,
      panZoomController.panY,
      panZoomController.viewScale
    );
  };

  // Debounced version for slider inputs (lil delay for smoother interaction)
  const debouncedDrawMap = debounce(
    drawMap,
    lerp(0, 5, settings.resolution, 0, 1)
  );

  const updateButtonPosition = () => {
    const titleWidth = mapTitle.offsetWidth;
    loadTitleBtn.style.transform = `translate(${titleWidth / 2 + 16}px, -50%)`;
  };

  const drawTitle = (n?: string) => {
    const name =
      n ??
      nameGenerator.generate({
        lang:
          selectedLanguages.length === 0
            ? undefined
            : selectedLanguages[
                Math.floor(Math.random() * selectedLanguages.length)
              ],
      });
    mapTitle.value = name;
    setTimeout(updateButtonPosition, 0);
  };

  const redraw = () => {
    drawTitle(mapName);
    drawMap();
  };

  const loadMap = (n: string) => {
    if (!n.trim()) {
      alert("Please enter the name of a map to load in");
      mapName = "";
      mapTitle.value = "";
      return;
    }
    mapName = n;
    mapGenerator.reSeed(n);
    mapCache.clear();

    panZoomController.resetPan();
    redraw();
  };

  // --- Pan/Zoom controller
  const panZoomController = new PanZoomController({
    canvas,
    onRedraw: drawMap,
    getCachedMap: () => mapCache.get(getCacheKey(settings)) ?? null,
    momentum: 0.3,
    onZoomChange: (zoom, viewScale) => {
      zoomInput.value = String(zoom);
      zoomLabel.textContent = viewScale.toFixed(2);
    },
  });

  // --- Initialize zoom
  zoomInput.value = String(settings.zoom);
  panZoomController.setZoom(settings.zoom);
  zoomLabel.textContent = panZoomController.viewScale.toFixed(2);
  zoomInput.addEventListener("input", () => {
    settings.zoom = Number(zoomInput.value);
    panZoomController.setZoom(settings.zoom);
    drawMap();
  });

  // --- Generic slider binder (uses numericity from defs)
  const bindSlider = (def: SliderDef) => {
    const { key, idBase, min, max, step } = def;
    const input = fetchElement<HTMLInputElement>(idBase);
    const label = fetchElement<HTMLSpanElement>(`${idBase}Value`);

    // Apply numeric constraints to the input element
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);

    // Initialize from settings
    const init = Number(settings[key]);
    input.value = String(init);
    label.textContent = init.toFixed(2);

    input.addEventListener("input", () => {
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = Number(MAP_DEFAULTS[key]);

      if (v < min) v = min;
      else if (v > max) v = max;

      settings[key] = v as any;
      input.value = String(v);
      label.textContent = v.toFixed(2);

      // Use debounced version for smoother slider interaction
      debouncedDrawMap();
    });

    return { input, label, decimals: 2 };
  };

  // Bind all numeric sliders uniformly
  const bound = Object.fromEntries(
    sliderDefs.map((d) => [d.key, bindSlider(d)])
  ) as Record<
    NumKey,
    { input: HTMLInputElement; label: HTMLSpanElement; decimals: number }
  >;

  // When either slider moves, mirror the other if linked
  bound.terrainFrequency.input.addEventListener("input", () => {
    const v = Number(bound.terrainFrequency.input.value);
    syncFreq("terrainFrequency", v);
  });

  bound.weatherFrequency.input.addEventListener("input", () => {
    const v = Number(bound.weatherFrequency.input.value);
    syncFreq("weatherFrequency", v);
  });

  // --- Theme radios
  themeRadios.forEach((radio) => {
    radio.checked = radio.value === settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        settings.theme = radio.value as MapSettings["theme"];
        debouncedDrawMap();
      }
    });
  });

  // --- Language selection helpers
  const getCategoryLanguages = (category: string) =>
    Array.from(languageCheckboxes).filter((cb) => {
      const parent = cb.closest(".language-category");
      const catCb =
        parent?.querySelector<HTMLInputElement>(".category-checkbox");
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
    selectedLanguages = Array.from(languageCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value as Language);
    const allChecked = Array.from(languageCheckboxes).every((cb) => cb.checked);
    toggleAllLanguagesBtn.textContent = allChecked
      ? "deselect all"
      : "select all";
  };

  // Wire category checkboxes
  categoryCheckboxes.forEach((catCb) => {
    catCb.addEventListener("change", () => {
      getCategoryLanguages(catCb.dataset.category ?? "").forEach(
        (cb) => (cb.checked = catCb.checked)
      );
      updateSelectedLanguages();
    });
  });

  // Wire individual language checkboxes
  languageCheckboxes.forEach((cb) => {
    cb.checked = selectedLanguages.includes(cb.value as Language);
    cb.addEventListener("change", () => {
      updateSelectedLanguages();
      const parent = cb.closest(".language-category");
      const catCb =
        parent?.querySelector<HTMLInputElement>(".category-checkbox");
      if (catCb) updateCategoryCheckbox(catCb);
    });
  });

  // Initialize category states
  categoryCheckboxes.forEach(updateCategoryCheckbox as any);
  updateSelectedLanguages();

  // Toggle-all button
  toggleAllLanguagesBtn.addEventListener("click", () => {
    const all = Array.from(languageCheckboxes).every((cb) => cb.checked);
    languageCheckboxes.forEach((cb) => (cb.checked = !all));
    categoryCheckboxes.forEach((cb) => {
      cb.checked = !all;
      cb.indeterminate = false;
    });
    updateSelectedLanguages();
  });

  // --- Buttons
  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    mapName = nameGenerator.generate({
      lang:
        selectedLanguages.length === 0
          ? undefined
          : selectedLanguages[
              Math.floor(Math.random() * selectedLanguages.length)
            ],
    });
    mapGenerator.reSeed(mapName);
    mapCache.clear();
    panZoomController.resetPan();
    redraw();
  });

  const fadeOut = (btn: HTMLButtonElement) => {
    btn.classList.add("clicked");
    // 2) In the next frame, enable transitions
    requestAnimationFrame(() => {
      btn.classList.add("enable-transition");

      // 3) After a short display, remove highlight -> will fade back
      setTimeout(() => {
        btn.classList.remove("clicked");
        // optional cleanup after it finishes fading
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

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);

    lockFrequencies.checked = true;

    // Reset settings to defaults
    URL_NUM_KEYS.forEach((k) => {
      settings[k] = MAP_DEFAULTS[k] as any;
    });

    // Sync UI for sliders (respect per-slider decimals)
    SLIDER_KEYS.forEach((k) => {
      const { input, label, decimals } = bound[k];
      const v = Number(settings[k]);
      input.value = String(v);
      label.textContent = v.toFixed(decimals);
    });

    // Sync zoom separately
    zoomInput.value = String(settings.zoom);
    panZoomController.setZoom(settings.zoom);
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
      loadMap(mapTitle.value.trim());
      mapTitle.blur();
    }
  });

  mapTitle.addEventListener("input", updateButtonPosition);

  const playEffect = (btn: HTMLElement, effect: "bounce" | "spin") => {
    btn.classList.remove(effect);
    void btn.offsetWidth; // reflow so animation restarts
    btn.classList.add(effect);
  };

  downloadBtn.addEventListener("click", () => {
    playEffect(downloadBtn, "bounce");
    // Show the popup dialog for download options
    const popupBackdrop = document.getElementById("popupBackdrop");
    if (popupBackdrop) {
      popupBackdrop.classList.add("show");
    }
  });

  uploadBtn.addEventListener("click", () => {
    playEffect(uploadBtn, "bounce");
    handleUpload();
  });

  const handleCancelPopup = () => {
    if (popupBackdrop) {
      popupBackdrop.classList.remove("show");
    }
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("click", clickHandler);
  };

  // Add ESC key handler to close popup
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancelPopup();
    }
  };

  const clickHandler = (e: MouseEvent) => {
    if (e.target === popupBackdrop) handleCancelPopup();
  };

  // Attach ESC handler when popup is shown
  const popupBackdrop = document.getElementById("popupBackdrop");
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

  const downloadPNG = () => {
    handleDownloadPNG();
    handleCancelPopup();
  };

  const downloadSave = () => {
    handleDownloadSave();
    handleCancelPopup();
  };

  downloadPNGBtn.addEventListener("click", () => {
    downloadPNG();
  });

  downloadSaveBtn.addEventListener("click", () => {
    downloadSave();
  });

  cancelPopupBtn.addEventListener("click", () => {
    handleCancelPopup();
  });

  const handleDownloadSave = () => {
    const mapTitleText = mapTitle.value || "Untitled Map";
    const data = {
      seed: mapName,
      mapSettings: {
        ...settings,
        zoom: undefined, // Exclude zoom explicitly
      },
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${mapTitleText.replace(/\s+/g, "_")}.mapination`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
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
    // Safe type check on loaded settings
    if (!isMapSettings(mapSettings)) {
      alert("Invalid map settings in file.");
      return;
    }

    settings = mapSettings;
    themeRadios.forEach((radio) => {
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

    const link = document.createElement("a");
    link.download = `${mapTitleText.replace(/\s+/g, "_")}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  };

  // --- Initial render
  redraw();
  setTimeout(updateButtonPosition, 100);
});
