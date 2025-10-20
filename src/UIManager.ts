// === UTILITY FUNCTIONS ===
const fetchElement = <T extends HTMLElement>(id: string): T => {
  const elem = document.getElementById(id) as T | null;
  if (!elem) {
    alert(`UI init failed. Missing #${id}`);
    throw new Error(`UI init failed. Missing #${id}`);
  }
  return elem;
};

// === TYPES AND CONSTANTS ===
export type NumKey =
  | "resolution"
  | "rainfall"
  | "seaLevel"
  | "clumpiness"
  | "elevationContrast"
  | "moistureContrast"
  | "terrainFrequency"
  | "weatherFrequency";

export type SliderDef = {
  key: NumKey;
  idBase: string;
  min: number;
  max: number;
  step: number;
};

export type BoundSlider = {
  input: HTMLInputElement;
  label: HTMLSpanElement;
  decimals: number;
};

export type UIElements = {
  // Core elements
  map: HTMLCanvasElement;
  mapTitle: HTMLInputElement;
  zoom: HTMLInputElement;
  zoomValue: HTMLSpanElement;
  
  // Buttons
  regen: HTMLButtonElement;
  regenBtnImg: HTMLImageElement;
  resetSliders: HTMLButtonElement;
  loadTitleBtn: HTMLButtonElement;
  loadTitleBtnImg: HTMLImageElement;
  download: HTMLButtonElement;
  upload: HTMLButtonElement;
  downloadPNG: HTMLButtonElement;
  downloadSave: HTMLButtonElement;
  cancelPopup: HTMLButtonElement;
  toggleAllLanguages: HTMLButtonElement;
  
  // Collections
  themeRadios: NodeListOf<HTMLInputElement>;
  languageCheckboxes: NodeListOf<HTMLInputElement>;
  categoryCheckboxes: NodeListOf<HTMLInputElement>;
  lockFrequencies: HTMLInputElement;
};

export const sliderDefs: readonly SliderDef[] = [
  { key: "resolution", idBase: "resolution", min: 0, max: 1, step: 0.01 },
  { key: "rainfall", idBase: "rainfall", min: 0, max: 1, step: 0.01 },
  { key: "seaLevel", idBase: "seaLevel", min: 0, max: 1, step: 0.01 },
  { key: "clumpiness", idBase: "clumpiness", min: -1, max: 1, step: 0.01 },
  { key: "elevationContrast", idBase: "elevationContrast", min: 0, max: 1, step: 0.01 },
  { key: "moistureContrast", idBase: "moistureContrast", min: 0, max: 1, step: 0.01 },
  { key: "terrainFrequency", idBase: "terrainFrequency", min: 0, max: 1, step: 0.01 },
  { key: "weatherFrequency", idBase: "weatherFrequency", min: 0, max: 1, step: 0.01 },
];

export class UIManager {
  private elements: UIElements;
  private boundSliders: Record<NumKey, BoundSlider> = {} as any;

  constructor() {
    this.elements = this.initializeElements();
    this.initializeSliders();
  }

  private initializeElements(): UIElements {
    const elementIds = [
      "map", "regen", "regenBtnImg", "resetSliders", "zoom", "zoomValue",
      "mapTitle", "loadTitleBtn", "loadTitleBtnImg", "download", "upload",
      "downloadPNG", "downloadSave", "cancelPopup", "toggleAllLanguages"
    ];

    const elements: any = {};
    elementIds.forEach(id => {
      elements[id] = fetchElement(id);
    });

    // Initialize collections
    elements.themeRadios = document.querySelectorAll(".theme-radio") as NodeListOf<HTMLInputElement>;
    elements.languageCheckboxes = document.querySelectorAll(".language-checkbox") as NodeListOf<HTMLInputElement>;
    elements.categoryCheckboxes = document.querySelectorAll(".category-checkbox") as NodeListOf<HTMLInputElement>;
    elements.lockFrequencies = document.getElementById("lockFrequencies") as HTMLInputElement || 
      Object.assign(document.createElement("input"), { checked: true });

    return elements as UIElements;
  }

  private initializeSliders() {
    sliderDefs.forEach(def => {
      const input = fetchElement<HTMLInputElement>(def.idBase);
      const label = fetchElement<HTMLSpanElement>(`${def.idBase}Value`);

      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);

      this.boundSliders[def.key] = { input, label, decimals: 2 };
    });
  }

  getAllElements(): UIElements {
    return this.elements;
  }

  getSlider(key: NumKey): BoundSlider {
    return this.boundSliders[key];
  }

  updateSliderValue(key: NumKey, value: number) {
    const slider = this.boundSliders[key];
    slider.input.value = String(value);
    slider.label.textContent = value.toFixed(slider.decimals);
  }

  get lockFrequencies() {
    return this.elements.lockFrequencies;
  }

  get themeRadios() {
    return this.elements.themeRadios;
  }

  get languageCheckboxes() {
    return this.elements.languageCheckboxes;
  }

  get categoryCheckboxes() {
    return this.elements.categoryCheckboxes;
  }
}
