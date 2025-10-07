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

  const drawMap = () => {
    const map: Map = mapGenerator.generateMap(settings);
    mapRenderer.drawCellColors(canvas, map, settings);
  };

  const drawTitle = (n: string | undefined = undefined) => {
    const name = n ?? nameGenerator.generate({});
    mapTitle.textContent = name;
  }

  const redraw = () => {
    drawTitle(mapName);
    drawMap();
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
    redraw();
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

  shatterInput.addEventListener("input", () => {
    settings.shatter = Number(shatterInput.value);
    shatterLabel.textContent = settings.shatter.toFixed(2);
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

  colorSchemeSelect.addEventListener("change", () => {
    settings.colorScheme = colorSchemeSelect.value as MapGenSettings["colorScheme"];
    drawMap();
  });

  regenBtn.addEventListener("click", () => {
    nameGenerator.reSeed(`${Date.now()}`)
    mapName = nameGenerator.generate();
    mapGenerator.reSeed(mapName);
    

    redraw();
  });

  // initial render
  redraw();

  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  downloadBtn.addEventListener("click", () => {
    const mapTitle = (document.getElementById("map-title") as HTMLElement)?.innerText || "Untitled Map";

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
