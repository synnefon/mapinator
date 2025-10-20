import { Languages, type Language } from "./common/language";
import {
  MAP_DEFAULTS,
  NUMERIC_SETTING_KEYS,
  type MapSettings,
  type NumericSettingKey,
} from "./common/settings";

// === APPLICATION STATE ===
export class AppState {
  private _settings: Pick<MapSettings, NumericSettingKey> & {
    theme: MapSettings["theme"];
  };
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
      theme:
        (urlParams.get("theme") as MapSettings["theme"]) ?? MAP_DEFAULTS.theme,
    };

    const urlMapName = urlParams.get("name") || urlParams.get("seed");
    this._mapName = urlMapName || "";
  }

  get settings() {
    return this._settings;
  }
  get selectedLanguages() {
    return this._selectedLanguages;
  }
  get mapName() {
    return this._mapName;
  }
  get syncingFreq() {
    return this._syncingFreq;
  }

  set settings(value) {
    this._settings = value;
  }
  set selectedLanguages(value) {
    this._selectedLanguages = value;
  }
  set mapName(value) {
    this._mapName = value;
  }
  set syncingFreq(value) {
    this._syncingFreq = value;
  }

  updateSetting<K extends keyof typeof this._settings>(
    key: K,
    value: (typeof this._settings)[K]
  ) {
    this._settings[key] = value;
  }
}
