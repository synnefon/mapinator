import { v4 as uuid } from 'uuid';
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

const genSeed = () => uuid().substring(0, 18).replaceAll("-", ""); // actually len 16

document.addEventListener("DOMContentLoaded", () => {
  let seed = genSeed();

  // Single source of truth
  const settings: MapGenSettings = { ...DEFAULTS };

  const mapGenerator = new MapGenerator(seed);
  const nameGenerator = new NameGenerator(seed);
  const mapRenderer = new MapRenderer();

  const drawMap = () => {
    const map: Map = mapGenerator.generateMap(settings);
    mapRenderer.drawCellColors(canvas, map, settings.greyScale);
  };

  const drawTitle = () => {
    const name = nameGenerator.generate({});

    const mapTitle = fetchElement<HTMLParagraphElement>("map-title");
    mapTitle.textContent = name;
  }

  const drawSeed = () => {
    const mapSeed = fetchElement<HTMLInputElement>("seed-input");
    mapSeed.value = seed;
  }

  const redraw = () => {
    drawTitle();
    drawMap();
    drawSeed();
  }

  const loadSeed = (s: string) => {
    seed = s;
    mapGenerator.reSeed(seed);
    nameGenerator.reSeed(seed);
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

  const edgeCurveInput = fetchElement<HTMLInputElement>("edgeCurve");
  const edgeCurveLabel = fetchElement<HTMLSpanElement>("edgeCurveValue");

  const resolutionInput = fetchElement<HTMLInputElement>("resolution");
  const resolutionLabel = fetchElement<HTMLSpanElement>("resolutionValue");

  const greyscaleInput = fetchElement<HTMLInputElement>("grayscale");

  const seedInput = fetchElement<HTMLInputElement>("seed-input");
  const loadBtn = fetchElement<HTMLButtonElement>("load-seed-btn");

  // Initialize sliders + labels from DEFAULTS
  wavelengthInput.value = String(settings.wavelength);
  wavelengthLabel.textContent = settings.wavelength.toFixed(2);

  rainfallInput.value = String(settings.rainfall);
  rainfallLabel.textContent = settings.rainfall.toFixed(2);

  seaLevelInput.value = String(settings.seaLevel);
  seaLevelLabel.textContent = settings.seaLevel.toFixed(2);

  shatterInput.value = String(settings.shatter);
  shatterLabel.textContent = settings.shatter.toFixed(2);

  edgeCurveInput.value = String(settings.edgeCurve);
  edgeCurveLabel.textContent = settings.edgeCurve.toFixed(2);

  resolutionInput.value = String(settings.resolution);
  resolutionLabel.textContent = settings.resolution.toFixed(2);

  greyscaleInput.checked = settings.greyScale;


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

  edgeCurveInput.addEventListener("input", () => {
    settings.edgeCurve = Number(edgeCurveInput.value);
    edgeCurveLabel.textContent = settings.edgeCurve.toFixed(2);
    drawMap();
  });

  resolutionInput.addEventListener("input", () => {
    settings.resolution = Number(resolutionInput.value);
    resolutionLabel.textContent = settings.resolution.toFixed(2);
    drawMap();
  });

  greyscaleInput.addEventListener("input", () => {
    settings.greyScale = greyscaleInput.checked;
    drawMap();
  });

  // Render only on explicit click
  regenBtn.addEventListener("click", () => {
    seed = genSeed();
    mapGenerator.reSeed(seed);
    nameGenerator.reSeed(seed);

    redraw();
  });

  // initial render
  redraw();

  const downloadBtn = fetchElement<HTMLButtonElement>("download");
  downloadBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.download = `map-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  });

  loadBtn.addEventListener("click", () => {
    const seed = seedInput.value.trim();
    loadSeed(seed);
  });
});
