import type { Map } from "./common/map";
import { DEFAULTS, type MapGenSettings } from "./common/settings";
import type { Language } from "./common/language";
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

document.addEventListener("DOMContentLoaded", () => {
  // Single source of truth
  const settings: MapGenSettings = { ...DEFAULTS };

  const nameGenerator = new NameGenerator(`${Date.now()}`);
  let selectedLanguages: Language[] = [];
  let mapName = nameGenerator.generate();

  const mapGenerator = new MapGenerator(mapName);
  const mapRenderer = new MapRenderer();

  // Cache for generated map to avoid regeneration
  let cachedMap: Map | null = null;
  let cachedSettingsKey = "";

  const drawMap = () => {
    // Create settings cache key (zoom removed - it's now just camera scale)
    const settingsKey = `${settings.resolution}|${settings.rainfall}|${settings.seaLevel}|${settings.clumpiness}|${settings.elevationContrast}|${settings.noiseScale}`;

    // Generate map if not cached or settings changed
    if (!cachedMap || cachedSettingsKey !== settingsKey) {
      cachedMap = mapGenerator.generateMap(settings);
      cachedSettingsKey = settingsKey;
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

  // const updateTitleFontSize = () => {
  //   const length = mapTitle.value.length;
  //   let fontSize: number;

  //   if (length <= 15) {
  //     fontSize = 2.0;
  //   } else if (length <= 25) {
  //     fontSize = 2.0 - ((length - 15) / 10) * 0.6; // 2.0 -> 1.4
  //   } else if (length <= 40) {
  //     fontSize = 1.4 - ((length - 25) / 15) * 0.5; // 1.4 -> 0.9
  //   } else {
  //     fontSize = Math.max(0.6, 0.9 - ((length - 40) / 30) * 0.3); // 0.9 -> 0.6
  //   }

  //   mapTitle.style.fontSize = `${fontSize}em`;
  // };

  const updateButtonPosition = () => {
    const titleWidth = mapTitle.offsetWidth;
    loadTitleBtn.style.transform = `translate(${titleWidth / 2 + 16}px, -50%)`;
  };

  const drawTitle = (n: string | undefined = undefined) => {
    const name = n ?? nameGenerator.generate({
      lang: selectedLanguages.length === 0
        ? undefined
        : selectedLanguages[Math.floor(Math.random() * selectedLanguages.length)]
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
    cachedMap = null;
    cachedSettingsKey = "";
    panZoomController.resetPan();
    redraw();
  };

  const canvas = fetchElement<HTMLCanvasElement>("map");
  const regenBtn = fetchElement<HTMLButtonElement>("regen");

  // Create pan/zoom controller
  const panZoomController = new PanZoomController({
    canvas,
    onRedraw: () => drawMap(),
    getCachedMap: () => cachedMap,
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
  const themeRadios = document.querySelectorAll<HTMLInputElement>(".theme-radio");

  // Language checkboxes
  const languageCheckboxes = document.querySelectorAll<HTMLInputElement>(".language-checkbox");
  const toggleAllLanguagesBtn = fetchElement<HTMLButtonElement>("toggle-all-languages");

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
  themeRadios.forEach(radio => {
    if (radio.value === settings.colorScheme) {
      radio.checked = true;
    }
  });

  // Update settings as the user moves sliders (then redraw)
  zoomInput.addEventListener("input", () => {
    settings.zoom = Number(zoomInput.value);
    panZoomController.setZoom(settings.zoom);
    drawMap();
  });

  rainfallInput.addEventListener("input", () => {
    settings.rainfall = Number(rainfallInput.value);
    rainfallLabel.textContent = settings.rainfall.toFixed(2);
    drawMap();
  });

  seaLevelInput.addEventListener("input", () => {
    settings.seaLevel = Number(seaLevelInput.value);
    seaLevelLabel.textContent = settings.seaLevel.toFixed(2);
    drawMap();
  });

  clumpinessInput.addEventListener("input", () => {
    settings.clumpiness = Number(clumpinessInput.value);
    clumpinessLabel.textContent = settings.clumpiness.toFixed(2);
    drawMap();
  });

  elevationContrastInput.addEventListener("input", () => {
    settings.elevationContrast = Number(elevationContrastInput.value);
    elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);
    drawMap();
  });

  resolutionInput.addEventListener("input", () => {
    settings.resolution = Number(resolutionInput.value);
    resolutionLabel.textContent = settings.resolution.toFixed(2);
    drawMap();
  });

  noiseScaleInput.addEventListener("input", () => {
    settings.noiseScale = Number(noiseScaleInput.value);
    noiseScaleLabel.textContent = settings.noiseScale.toFixed(2);
    drawMap();
  });

  themeRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        settings.colorScheme = radio.value as MapGenSettings["colorScheme"];
        drawMap();
      }
    });
  });

  // Update selected languages when checkboxes change
  const updateSelectedLanguages = () => {
    selectedLanguages = Array.from(languageCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value as Language);
  };

  // Category checkbox logic
  const categoryCheckboxes = document.querySelectorAll<HTMLInputElement>(".category-checkbox");

  const getCategoryLanguages = (category: string) => {
    return Array.from(languageCheckboxes).filter(cb => {
      const parentCategory = cb.closest('.language-category');
      const categoryCheckbox = parentCategory?.querySelector<HTMLInputElement>('.category-checkbox');
      return categoryCheckbox?.dataset.category === category;
    });
  };

  const updateCategoryCheckbox = (categoryCheckbox: HTMLInputElement) => {
    const categoryLanguages = getCategoryLanguages(categoryCheckbox.dataset.category || '');
    const allChecked = categoryLanguages.every(cb => cb.checked);
    const noneChecked = categoryLanguages.every(cb => !cb.checked);

    categoryCheckbox.checked = allChecked;
    categoryCheckbox.indeterminate = !allChecked && !noneChecked;
  };

  categoryCheckboxes.forEach(categoryCheckbox => {
    categoryCheckbox.addEventListener("change", () => {
      const categoryLanguages = getCategoryLanguages(categoryCheckbox.dataset.category || '');
      categoryLanguages.forEach(cb => {
        cb.checked = categoryCheckbox.checked;
      });
      updateSelectedLanguages();
    });
  });

  languageCheckboxes.forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      updateSelectedLanguages();
      // Update parent category checkbox state
      const parentCategory = checkbox.closest('.language-category');
      const categoryCheckbox = parentCategory?.querySelector<HTMLInputElement>('.category-checkbox');
      if (categoryCheckbox) {
        updateCategoryCheckbox(categoryCheckbox);
      }
    });
  });

  // Initialize selected languages on page load
  updateSelectedLanguages();

  // Toggle all languages button
  toggleAllLanguagesBtn.addEventListener("click", () => {
    const allChecked = Array.from(languageCheckboxes).every(cb => cb.checked);
    languageCheckboxes.forEach(cb => {
      cb.checked = !allChecked;
    });
    categoryCheckboxes.forEach(cb => {
      cb.checked = !allChecked;
      cb.indeterminate = false;
    });
    toggleAllLanguagesBtn.textContent = allChecked ? "select all" : "deselect all";
    updateSelectedLanguages();
  });

  regenBtn.addEventListener("click", () => {
    nameGenerator.reSeed(`${Date.now()}`);
    mapName = nameGenerator.generate({
      lang: selectedLanguages.length === 0
        ? undefined
        : selectedLanguages[Math.floor(Math.random() * selectedLanguages.length)]
    });
    mapGenerator.reSeed(mapName);
    cachedMap = null;
    cachedSettingsKey = "";
    panZoomController.resetPan();

    redraw();
  });

  // initial render
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
