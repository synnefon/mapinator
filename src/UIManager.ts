import { type NumericSettingKey } from "./common/settings";

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

export type SliderDef = {
  key: NumericSettingKey;
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
  plateArrows: HTMLCanvasElement; // 2D overlay for the plate-motion arrows (layered over #map)
  mapTitle: HTMLInputElement;

  // Buttons
  regenBtn: HTMLButtonElement;
  regenBtnImg: HTMLImageElement;
  northBtn: HTMLButtonElement;
  resetSlidersBtn: HTMLButtonElement;
  loadTitleBtn: HTMLButtonElement;
  loadTitleBtnImg: HTMLImageElement;
  downloadBtn: HTMLButtonElement;
  uploadBtn: HTMLButtonElement;
  downloadPNGBtn: HTMLButtonElement;
  downloadSaveBtn: HTMLButtonElement;
  cancelPopupBtn: HTMLButtonElement;
  // Dev-only (local server): overwrite settings.ts with the live dial values, behind a popup.
  saveSettingsBtn: HTMLButtonElement;
  confirmSaveSettingsBtn: HTMLButtonElement;
  cancelSaveSettingsBtn: HTMLButtonElement;
  // toggleAllLanguagesBtn: HTMLButtonElement;

  // Collections
  themeRadios: NodeListOf<HTMLInputElement>;
  languageCheckboxes: NodeListOf<HTMLInputElement>;
  categoryCheckboxes: NodeListOf<HTMLInputElement>;
  lockFrequencies: HTMLInputElement;
};

// Basic numeric-setting sliders. Currently none — zoom is driven by the orbit controls
// (wheel/pinch), sea level was removed, and resolution has no slider; kept as the wiring
// point if one's re-added.
export const sliderDefs: readonly SliderDef[] = [];

export class UIManager {
  private elements: UIElements;
  private boundSliders: Record<NumericSettingKey, BoundSlider> = {} as any;

  constructor() {
    this.elements = this.initializeElements();
    this.initializeSliders();
  }

  private initializeElements(): UIElements {
    const elementIds = [
      "map",
      "plateArrows",
      "regenBtn",
      "regenBtnImg",
      "northBtn",
      "resetSlidersBtn",
      "mapTitle",
      "loadTitleBtn",
      "loadTitleBtnImg",
      "downloadBtn",
      "uploadBtn",
      "downloadPNGBtn",
      "downloadSaveBtn",
      "cancelPopupBtn",
      "saveSettingsBtn",
      "confirmSaveSettingsBtn",
      "cancelSaveSettingsBtn",
      // "toggleAllLanguagesBtn",
    ];

    const elements: any = {};
    elementIds.forEach((id) => {
      elements[id] = fetchElement(id);
    });

    // Initialize collections
    elements.themeRadios = document.querySelectorAll(
      ".theme-radio"
    ) as NodeListOf<HTMLInputElement>;
    elements.languageCheckboxes = document.querySelectorAll(
      ".language-checkbox"
    ) as NodeListOf<HTMLInputElement>;
    elements.categoryCheckboxes = document.querySelectorAll(
      ".category-checkbox"
    ) as NodeListOf<HTMLInputElement>;
    // elements.lockFrequencies =
    //   (document.getElementById("lockFrequencies") as HTMLInputElement) ||
    //   Object.assign(document.createElement("input"), { checked: true });

    return elements as UIElements;
  }

  private initializeSliders() {
    sliderDefs.forEach((def) => {
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

  getSlider(key: NumericSettingKey): BoundSlider {
    return this.boundSliders[key];
  }

  updateSliderValue(key: NumericSettingKey, value: number) {
    const slider = this.boundSliders[key];
    slider.input.value = String(value);
    slider.label.textContent = value.toFixed(slider.decimals);
  }

  // get lockFrequencies() {
  //   return this.elements.lockFrequencies;
  // }

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
