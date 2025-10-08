import type { Map } from "./common/map";
import { DEFAULTS, type MapGenSettings } from "./common/settings";
import { lerp } from "./common/util";
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

  const drawTitle = (n: string | undefined = undefined) => {
    const name = n ?? nameGenerator.generate({});
    mapTitle.textContent = name;
  };

  const redraw = () => {
    drawTitle(mapName);
    drawMap();
  };

  const loadMap = (n: string) => {
    if (!n.trim()) {
      alert("Please enter the name of a map to load in");
      mapName = "";
      seedInput.textContent = "";
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

  // Color scheme dropdown
  const colorSchemeSelect = fetchElement<HTMLSelectElement>("colorScheme");

  const seedInput = fetchElement<HTMLInputElement>("seed-input");
  const loadBtn = fetchElement<HTMLButtonElement>("load-seed-btn");

  const mapTitle = fetchElement<HTMLParagraphElement>("map-title");

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

  colorSchemeSelect.value = settings.colorScheme;

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

  colorSchemeSelect.addEventListener("change", () => {
    settings.colorScheme =
      colorSchemeSelect.value as MapGenSettings["colorScheme"];
    drawMap();
  });

  regenBtn.addEventListener("click", () => {
    nameGenerator.reSeed(`${Date.now()}`);
    mapName = nameGenerator.generate();
    mapGenerator.reSeed(mapName);
    cachedMap = null;
    cachedSettingsKey = "";
    panZoomController.resetPan();

    redraw();
  });

  // initial render
  redraw();

  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  downloadBtn.addEventListener("click", () => {
    const mapTitle =
      (document.getElementById("map-title") as HTMLElement)?.innerText ||
      "Untitled Map";

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
    ctx.fillText(mapTitle, exportCanvas.width / 2, 40);

    // download
    const link = document.createElement("a");
    link.download = `MAPINATOR_${mapTitle.replace(/\s+/g, "_")}.png`;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();
  });

  loadBtn.addEventListener("click", () => {
    mapName = seedInput.value.trim();
    loadMap(mapName);
  });
});
