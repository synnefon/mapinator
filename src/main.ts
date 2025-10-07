import { DEFAULTS, type MapGenSettings } from "./common/config";
import type { Map } from "./common/map";
import { MapGenerator } from "./mapgen/MapGenerator";
import { NameGenerator } from "./mapgen/NameGenerator";
import { MapRenderer } from "./renderer/MapRenderer";

const fetchElement = <T>(id: string): T => {
  const elem = document.getElementById(id) as T;
  if (!elem) {
    alert("UI init failed. Check element IDs.");
    throw new Error("UI init failed. Check element IDs.");
  }
  return elem;
}

document.addEventListener("DOMContentLoaded", () => {
  // Single source of truth
  const settings: MapGenSettings = { ...DEFAULTS };

  const nameGenerator = new NameGenerator(`${Date.now()}`);
  let mapName = nameGenerator.generate();

  const mapGenerator = new MapGenerator(mapName);
  const mapRenderer = new MapRenderer();

  const drawMap = (canvas) => {
    const map: Map = mapGenerator.generateMap(settings);
    mapRenderer.clearCells(canvas);
    mapRenderer.drawCellColors(canvas, map);
    mapRenderer.drawPixelShadows(canvas, map);
  };

  const drawTitle = (n: string | undefined = undefined) => {
    const name = n ?? nameGenerator.generate({});
    mapTitle.textContent = name;
  }

  const redraw = (canvas) => {
    drawTitle(mapName);
    drawMap(canvas);
  }

  const loadMap = (n: string) => {
    if (!n.trim()) {
      alert("Please enter the name of a map to load in");
      mapName = "";
      seedInput.textContent = "";
      return;
    }
    mapName = n;
    mapGenerator.reSeed(n);
    redraw(canvas);
  }

  const canvas = fetchElement<HTMLCanvasElement>("map");
  const regenBtn = fetchElement<HTMLButtonElement>("regen");

  const wavelengthInput = fetchElement<HTMLInputElement>("wavelength");
  const wavelengthLabel = fetchElement<HTMLSpanElement>("wavelengthValue");

  const rainfallInput = fetchElement<HTMLInputElement>("rainfall");
  const rainfallLabel = fetchElement<HTMLSpanElement>("rainfallValue");

  const seaLevelInput = fetchElement<HTMLInputElement>("seaLevel");
  const seaLevelLabel = fetchElement<HTMLSpanElement>("seaLevelValue");
  
  const shatterInput = fetchElement<HTMLInputElement>("shatter");
  const shatterLabel = fetchElement<HTMLSpanElement>("shatterValue");

  const elevationContrastInput = fetchElement<HTMLInputElement>("elevationContrast");
  const elevationContrastLabel = fetchElement<HTMLSpanElement>("elevationContrastValue");

  const resolutionInput = fetchElement<HTMLInputElement>("resolution");
  const resolutionLabel = fetchElement<HTMLSpanElement>("resolutionValue");

  // Color scheme dropdown
  const colorSchemeSelect = fetchElement<HTMLSelectElement>("colorScheme");

  const seedInput = fetchElement<HTMLInputElement>("seed-input");
  const loadBtn = fetchElement<HTMLButtonElement>("load-seed-btn");

  const mapTitle = fetchElement<HTMLParagraphElement>("map-title");

  // Initialize sliders + labels from DEFAULTS
  wavelengthInput.value = String(settings.wavelength);
  wavelengthLabel.textContent = settings.wavelength.toFixed(2);

  rainfallInput.value = String(settings.rainfall);
  rainfallLabel.textContent = settings.rainfall.toFixed(2);

  seaLevelInput.value = String(settings.seaLevel);
  seaLevelLabel.textContent = settings.seaLevel.toFixed(2);

  shatterInput.value = String(settings.shatter);
  shatterLabel.textContent = settings.shatter.toFixed(2);

  elevationContrastInput.value = String(settings.elevationContrast);
  elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);

  resolutionInput.value = String(settings.resolution);
  resolutionLabel.textContent = settings.resolution.toFixed(2);

  colorSchemeSelect.value = settings.colorScheme;

  // Update settings as the user moves sliders (then redraw)
  wavelengthInput.addEventListener("input", () => {
    settings.wavelength = Number(wavelengthInput.value);
    wavelengthLabel.textContent = settings.wavelength.toFixed(2);
    drawMap(canvas);
  });

  rainfallInput.addEventListener("input", () => {
    settings.rainfall = Number(rainfallInput.value);
    rainfallLabel.textContent = settings.rainfall.toFixed(2);
    drawMap(canvas);
  });

  seaLevelInput.addEventListener("input", () => {
    settings.seaLevel = Number(seaLevelInput.value);
    seaLevelLabel.textContent = settings.seaLevel.toFixed(2);
    drawMap(canvas);
  });

  shatterInput.addEventListener("input", () => {
    settings.shatter = Number(shatterInput.value);
    shatterLabel.textContent = settings.shatter.toFixed(2);
    drawMap(canvas);
  });

  elevationContrastInput.addEventListener("input", () => {
    settings.elevationContrast = Number(elevationContrastInput.value);
    elevationContrastLabel.textContent = settings.elevationContrast.toFixed(2);
    drawMap(canvas);
  });

  resolutionInput.addEventListener("input", () => {
    settings.resolution = Number(resolutionInput.value);
    resolutionLabel.textContent = settings.resolution.toFixed(2);
    drawMap(canvas);
  });

  colorSchemeSelect.addEventListener("change", () => {
    settings.colorScheme = colorSchemeSelect.value as MapGenSettings["colorScheme"];
    drawMap(canvas);
  });

  // Render only on explicit click
  regenBtn.addEventListener("click", () => {
    mapName = nameGenerator.generate();
    mapGenerator.reSeed(mapName);
    nameGenerator.reSeed(mapName);

    redraw(canvas);
  });

  // initial render
  redraw(canvas);

  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  downloadBtn.addEventListener("click", () => {
    const mapTitle = (document.getElementById("map-title") as HTMLElement)?.innerText || "Untitled Map";

    // create a temporary canvas with extra space for title
    const exportCanvas = document.createElement("canvas");
    const padding = 120;
    exportCanvas.width = canvas.width * 2;
    exportCanvas.height = (canvas.height * 2) + padding;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#fcf5e5";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // draw map
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = exportCanvas.width;
    mapCanvas.height = exportCanvas.width;
    drawMap(mapCanvas);
    ctx.drawImage(mapCanvas, 0, padding);

    // draw title
    ctx.font = "bold 6.5em 'Roboto Mono', monospace";
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.fillText(mapTitle, exportCanvas.width / 2, 80);

    // download
    const link = document.createElement("a");
    let map_name = fetchElement<HTMLParagraphElement>("map-title").textContent;
    let date = new Date().toLocaleDateString('en-CA').replace(/-/g, "");
    let filename = `map-${map_name.toLowerCase()}-${date}.png`;
    link.download = filename;
    link.href = exportCanvas.toDataURL("image/png");
    link.click();

    exportCanvas.remove();
  });

  loadBtn.addEventListener("click", () => {
    mapName = seedInput.value.trim();
    loadMap(mapName);
  });
});
