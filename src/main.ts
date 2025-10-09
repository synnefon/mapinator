import { Languages, type Language } from "./common/language";
import type { WorldMap } from "./common/map";
import { DEFAULTS, type MapSettings } from "./common/settings";
import { MapGenerator } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MapRenderer } from "./renderer/MapRenderer";
import { PanZoomController } from "./renderer/PanZoomController";

const fetchElement = <T>(id: string): T => {
  const elem = document.getElementById(id) as T;
  if (!elem) {
    alert("UI init failed. Check element IDs.");
    throw new Error("UI init failed. Check element IDs.");
  }
  return elem;
};

const getCacheKey = (settings: MapSettings) => {
  return `${settings.resolution}|${settings.rainfall}|${settings.seaLevel}|${settings.clumpiness}|${settings.elevationContrast}|${settings.noiseScale}`;
};

const mapCache = new Map<string, WorldMap>();

document.addEventListener("DOMContentLoaded", () => {
  // Check URL for parameters
  const urlParams = new URLSearchParams(window.location.search);
  const urlMapName = urlParams.get("name") || urlParams.get("seed");

  // Load settings from URL or use defaults
  const settings: MapSettings = {
    resolution: parseFloat(urlParams.get("resolution") || String(DEFAULTS.resolution)),
    jitter: parseFloat(urlParams.get("jitter") || String(DEFAULTS.jitter)),
    zoom: parseFloat(urlParams.get("zoom") || String(DEFAULTS.zoom)),
    rainfall: parseFloat(urlParams.get("rainfall") || String(DEFAULTS.rainfall)),
    seaLevel: parseFloat(urlParams.get("seaLevel") || String(DEFAULTS.seaLevel)),
    clumpiness: parseFloat(urlParams.get("clumpiness") || String(DEFAULTS.clumpiness)),
    edgeCurve: parseFloat(urlParams.get("edgeCurve") || String(DEFAULTS.edgeCurve)),
    elevationContrast: parseFloat(urlParams.get("elevationContrast") || String(DEFAULTS.elevationContrast)),
    theme: (urlParams.get("theme") as MapSettings["theme"]) || DEFAULTS.theme,
    noiseScale: parseFloat(urlParams.get("noiseScale") || String(DEFAULTS.noiseScale)),
  };

  const nameGenerator = new NameGenerator(`${Date.now()}`);

  // Initialize with all languages selected
  let selectedLanguages: Language[] = [...Languages];

  let mapName = urlMapName || nameGenerator.generate();

  const mapGenerator = new MapGenerator(mapName);
  const mapRenderer = new MapRenderer();

  // Update URL with current map name and all settings
  const updateURL = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("name", mapName);
    url.searchParams.set("resolution", String(settings.resolution));
    url.searchParams.set("rainfall", String(settings.rainfall));
    url.searchParams.set("seaLevel", String(settings.seaLevel));
    url.searchParams.set("clumpiness", String(settings.clumpiness));
    url.searchParams.set("edgeCurve", String(settings.edgeCurve));
    url.searchParams.set("elevationContrast", String(settings.elevationContrast));
    url.searchParams.set("theme", settings.theme);
    url.searchParams.set("noiseScale", String(settings.noiseScale));
    url.searchParams.set("zoom", String(settings.zoom));

    window.history.replaceState({}, "", url.toString());
  };

  const drawMap = () => {
    // Create settings cache key (zoom removed - it's now just camera scale)
    const cacheKey = getCacheKey(settings);
    let cachedMap = mapCache.get(cacheKey);
    if (!cachedMap) {
      cachedMap = mapGenerator.generateMap(settings);
      mapCache.set(cacheKey, cachedMap);
    }
    // Render with current pan and camera zoom (viewport culling happens in renderer)
    mapRenderer.drawCellColors(
      canvas,
      cachedMap,
      settings,
      panZoomController.panX,
      panZoomController.panY,
      panZoomController.viewScale
    );
  };

  const updateButtonPosition = () => {
    const titleWidth = mapTitle.offsetWidth;
    loadTitleBtn.style.transform = `translate(${titleWidth / 2 + 16}px, -50%)`;
  };

  const drawTitle = (n: string | undefined = undefined) => {
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
    // updateTitleFontSize();
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
    updateURL();
    redraw();
  };

  const canvas = fetchElement<HTMLCanvasElement>("map");
  const regenBtn = fetchElement<HTMLButtonElement>("regen");
  const resetSlidersBtn = fetchElement<HTMLButtonElement>("reset-sliders");

  // Create pan/zoom controller
  const panZoomController = new PanZoomController({
    canvas,
    onRedraw: () => drawMap(),
    getCachedMap: () => mapCache.get(getCacheKey(settings)) ?? null,
    momentum: 0.3,
    onZoomChange: (zoom, viewScale) => {
      zoomInput.value = String(zoom);
      zoomLabel.textContent = viewScale.toFixed(2);
    },
  });

  const zoomInput = fetchElement<HTMLInputElement>("zoom");
  const zoomLabel = fetchElement<HTMLSpanElement>("zoomValue");

  const rainfallInput = fetchElement<HTMLInputElement>("rainfall");
  const rainfallLabel = fetchElement<HTMLSpanElement>("rainfallValue");

  const seaLevelInput = fetchElement<HTMLInputElement>("seaLevel");
  const seaLevelLabel = fetchElement<HTMLSpanElement>("seaLevelValue");

  const clumpinessInput = fetchElement<HTMLInputElement>("clumpiness");
  const clumpinessLabel = fetchElement<HTMLSpanElement>("clumpinessValue");

  const elevationContrastInput =
    fetchElement<HTMLInputElement>("elevationContrast");
  const elevationContrastLabel = fetchElement<HTMLSpanElement>(
    "elevationContrastValue"
  );

  const resolutionInput = fetchElement<HTMLInputElement>("resolution");
  const resolutionLabel = fetchElement<HTMLSpanElement>("resolutionValue");

  const noiseScaleInput = fetchElement<HTMLInputElement>("noiseScale");
  const noiseScaleLabel = fetchElement<HTMLSpanElement>("noiseScaleValue");

  // Color scheme radio buttons
  const themeRadios =
    document.querySelectorAll<HTMLInputElement>(".theme-radio");

  // Language checkboxes
  const languageCheckboxes =
    document.querySelectorAll<HTMLInputElement>(".language-checkbox");
  const toggleAllLanguagesBtn = fetchElement<HTMLButtonElement>(
    "toggle-all-languages"
  );

  const mapTitle = fetchElement<HTMLInputElement>("map-title");
  const loadTitleBtn = fetchElement<HTMLButtonElement>("load-title-btn");

  // Initialize sliders + labels from DEFAULTS
  zoomInput.value = String(settings.zoom);
  panZoomController.setZoom(settings.zoom); // Initialize controller zoom
  zoomLabel.textContent = panZoomController.viewScale.toFixed(2);

  rainfallInput.value = String(settings.rainfall);
  rainfallLabel.textContent = settings.rainfall.toFixed(2);

  seaLevelInput.value = String(settings.seaLevel);
  seaLevelLabel.textContent = settings.seaLevel.toFixed(2);

  clumpinessInput.value = String(settings.clumpiness);
  clumpinessLabel.textContent = settings.clumpiness.toFixed(2);

  elevationContrastInput.value = String(settings.elevationContrast);
  elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);

  resolutionInput.value = String(settings.resolution);
  resolutionLabel.textContent = settings.resolution.toFixed(2);

  noiseScaleInput.value = String(settings.noiseScale);
  noiseScaleLabel.textContent = settings.noiseScale.toFixed(2);

  // Initialize selected theme radio button
  themeRadios.forEach((radio) => {
    if (radio.value === settings.theme) {
      radio.checked = true;
    }
  });

  // Update settings as the user moves sliders (then redraw)
  zoomInput.addEventListener("input", () => {
    settings.zoom = Number(zoomInput.value);
    panZoomController.setZoom(settings.zoom);
    updateURL();
    drawMap();
  });

  rainfallInput.addEventListener("input", () => {
    settings.rainfall = Number(rainfallInput.value);
    rainfallLabel.textContent = settings.rainfall.toFixed(2);
    updateURL();
    drawMap();
  });

  seaLevelInput.addEventListener("input", () => {
    settings.seaLevel = Number(seaLevelInput.value);
    seaLevelLabel.textContent = settings.seaLevel.toFixed(2);
    updateURL();
    drawMap();
  });

  clumpinessInput.addEventListener("input", () => {
    settings.clumpiness = Number(clumpinessInput.value);
    clumpinessLabel.textContent = settings.clumpiness.toFixed(2);
    updateURL();
    drawMap();
  });

  elevationContrastInput.addEventListener("input", () => {
    settings.elevationContrast = Number(elevationContrastInput.value);
    elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);
    updateURL();
    drawMap();
  });

  resolutionInput.addEventListener("input", () => {
    settings.resolution = Number(resolutionInput.value);
    resolutionLabel.textContent = settings.resolution.toFixed(2);
    updateURL();
    drawMap();
  });

  noiseScaleInput.addEventListener("input", () => {
    settings.noiseScale = Number(noiseScaleInput.value);
    noiseScaleLabel.textContent = settings.noiseScale.toFixed(2);
    updateURL();
    drawMap();
  });

  themeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        settings.theme = radio.value as MapSettings["theme"];
        updateURL();
        drawMap();
      }
    });
  });

  // Update the toggle all button text
  const updateToggleAllButton = () => {
    const allChecked = Array.from(languageCheckboxes).every((cb) => cb.checked);
    toggleAllLanguagesBtn.textContent = allChecked ? "deselect all" : "select all";
  };

  // Update selected languages when checkboxes change
  const updateSelectedLanguages = () => {
    selectedLanguages = Array.from(languageCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value as Language);
    updateToggleAllButton();
  };

  // Category checkbox logic
  const categoryCheckboxes =
    document.querySelectorAll<HTMLInputElement>(".category-checkbox");

  const getCategoryLanguages = (category: string) => {
    return Array.from(languageCheckboxes).filter((cb) => {
      const parentCategory = cb.closest(".language-category");
      const categoryCheckbox =
        parentCategory?.querySelector<HTMLInputElement>(".category-checkbox");
      return categoryCheckbox?.dataset.category === category;
    });
  };

  const updateCategoryCheckbox = (categoryCheckbox: HTMLInputElement) => {
    const categoryLanguages = getCategoryLanguages(
      categoryCheckbox.dataset.category || ""
    );
    const allChecked = categoryLanguages.every((cb) => cb.checked);
    const noneChecked = categoryLanguages.every((cb) => !cb.checked);

    categoryCheckbox.checked = allChecked;
    categoryCheckbox.indeterminate = !allChecked && !noneChecked;
  };

  categoryCheckboxes.forEach((categoryCheckbox) => {
    categoryCheckbox.addEventListener("change", () => {
      const categoryLanguages = getCategoryLanguages(
        categoryCheckbox.dataset.category || ""
      );
      categoryLanguages.forEach((cb) => {
        cb.checked = categoryCheckbox.checked;
      });
      updateSelectedLanguages();
    });
  });

  languageCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      updateSelectedLanguages();
      // Update parent category checkbox state
      const parentCategory = checkbox.closest(".language-category");
      const categoryCheckbox =
        parentCategory?.querySelector<HTMLInputElement>(".category-checkbox");
      if (categoryCheckbox) {
        updateCategoryCheckbox(categoryCheckbox);
      }
    });
  });

  // Initialize language checkboxes from URL
  languageCheckboxes.forEach((checkbox) => {
    checkbox.checked = selectedLanguages.includes(checkbox.value as Language);
  });

  // Initialize category checkboxes based on language selections
  categoryCheckboxes.forEach((categoryCheckbox) => {
    updateCategoryCheckbox(categoryCheckbox);
  });

  // Initialize selected languages on page load
  updateSelectedLanguages();
  updateToggleAllButton();

  // Toggle all languages button
  toggleAllLanguagesBtn.addEventListener("click", () => {
    const allChecked = Array.from(languageCheckboxes).every((cb) => cb.checked);
    languageCheckboxes.forEach((cb) => {
      cb.checked = !allChecked;
    });
    categoryCheckboxes.forEach((cb) => {
      cb.checked = !allChecked;
      cb.indeterminate = false;
    });
    updateSelectedLanguages();
  });

  regenBtn.addEventListener("click", () => {
    nameGenerator.reSeed(`${Date.now()}`);
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
    updateURL();

    redraw();
  });

  resetSlidersBtn.addEventListener("click", () => {
    // Reset all settings to defaults
    settings.resolution = DEFAULTS.resolution;
    settings.rainfall = DEFAULTS.rainfall;
    settings.seaLevel = DEFAULTS.seaLevel;
    settings.clumpiness = DEFAULTS.clumpiness;
    settings.edgeCurve = DEFAULTS.edgeCurve;
    settings.elevationContrast = DEFAULTS.elevationContrast;
    settings.noiseScale = DEFAULTS.noiseScale;
    settings.zoom = DEFAULTS.zoom;

    // Update UI
    resolutionInput.value = String(settings.resolution);
    resolutionLabel.textContent = settings.resolution.toFixed(2);

    rainfallInput.value = String(settings.rainfall);
    rainfallLabel.textContent = settings.rainfall.toFixed(2);

    seaLevelInput.value = String(settings.seaLevel);
    seaLevelLabel.textContent = settings.seaLevel.toFixed(2);

    clumpinessInput.value = String(settings.clumpiness);
    clumpinessLabel.textContent = settings.clumpiness.toFixed(2);

    elevationContrastInput.value = String(settings.elevationContrast);
    elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);

    noiseScaleInput.value = String(settings.noiseScale);
    noiseScaleLabel.textContent = settings.noiseScale.toFixed(2);

    zoomInput.value = String(settings.zoom);
    panZoomController.setZoom(settings.zoom);

    // Clear cache and redraw
    mapCache.clear();
    updateURL();
    drawMap();
  });

  // initial render
  updateURL();
  redraw();

  // Initialize button position after render
  setTimeout(updateButtonPosition, 100);

  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  downloadBtn.addEventListener("click", () => {
    const mapTitleText = mapTitle.value || "Untitled Map";

    // create a temporary canvas with extra space for title
    const exportCanvas = document.createElement("canvas");
    const padding = 60;
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height + padding;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#dedede";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // draw map
    ctx.drawImage(canvas, 0, padding);

    // draw title
    ctx.font = "bold 36px 'Roboto Mono', monospace";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.fillText(mapTitleText, exportCanvas.width / 2, 40);

    // download
    const link = document.createElement("a");
    link.download = `MAPINATOR_${mapTitleText.replace(/\s+/g, "_")}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });

  loadTitleBtn.addEventListener("click", () => {
    mapName = mapTitle.value.trim();
    loadMap(mapName);
  });

  // Load seed on Enter key
  mapTitle.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      mapName = mapTitle.value.trim();
      loadMap(mapName);
      mapTitle.blur(); // Remove focus after loading
    }
  });

  // Update button position as user types
  mapTitle.addEventListener("input", updateButtonPosition);

  // Update font size as user types
  // mapTitle.addEventListener("input", updateTitleFontSize);
});
