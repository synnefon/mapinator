import { Languages, type Language } from "./common/language";
import {
  MAP_DEFAULTS,
  NUMERIC_SETTING_KEYS,
  type MapSettings,
  type TuningOverrides,
} from "./common/settings";

export type SettingKey = keyof MapSettings;
type SettingsListener = (key: SettingKey) => void;

// === APPLICATION STATE ===
// Single source of truth for the map settings + selection. Changing a setting through
// setSetting notifies subscribers, so the slider labels, theme colours, and redraw all
// react from one place instead of every call site hand-syncing the UI.
export class AppState {
  private _settings: MapSettings;
  private _selectedLanguages: Language[] = [...Languages];
  private _mapName: string;
  private listeners = new Set<SettingsListener>();
  // Advanced-settings overrides for the generation/appearance dials (dotted path → value).
  // Missing paths fall back to each dial's default; see applyTuning in settings.ts.
  private _tuning: TuningOverrides = {};

  constructor() {
    const urlParams = new URL(window.location.href).searchParams;
    const numFromUrl = (k: SettingKey) =>
      parseFloat(urlParams.get(k) ?? String(MAP_DEFAULTS[k]));

    const settings = { ...MAP_DEFAULTS };
    for (const k of NUMERIC_SETTING_KEYS) settings[k] = numFromUrl(k);
    settings.theme =
      (urlParams.get("theme") as MapSettings["theme"]) ?? MAP_DEFAULTS.theme;
    this._settings = settings;

    const urlMapName = urlParams.get("name") || urlParams.get("seed");
    // Map keys are case-insensitive — always stored upper case (see the mapName setter).
    this._mapName = (urlMapName || "").toUpperCase();
  }

  get settings(): Readonly<MapSettings> {
    return this._settings;
  }
  get selectedLanguages() {
    return this._selectedLanguages;
  }
  get mapName() {
    return this._mapName;
  }
  /** Current advanced-tuning overrides (read-only view). */
  get tuningOverrides(): Readonly<TuningOverrides> {
    return this._tuning;
  }

  set selectedLanguages(value: Language[]) {
    this._selectedLanguages = value;
  }
  set mapName(value: string) {
    this._mapName = value.toUpperCase(); // map keys are case-insensitive
  }

  /** Change one setting and notify subscribers (no-op if unchanged). */
  setSetting<K extends SettingKey>(key: K, value: MapSettings[K]): void {
    if (this._settings[key] === value) return;
    this._settings[key] = value;
    for (const fn of this.listeners) fn(key);
  }

  /** Replace all settings at once (loading a save), notifying per changed key. */
  replaceSettings(next: MapSettings): void {
    const changed = (Object.keys(next) as SettingKey[]).filter(
      (k) => this._settings[k] !== next[k]
    );
    this._settings = { ...next };
    for (const key of changed) for (const fn of this.listeners) fn(key);
  }

  /** Set one advanced-tuning override (dotted path → value). */
  setTuning(path: string, value: number): void {
    this._tuning[path] = value;
  }

  /** Drop one advanced-tuning override, reverting that dial to its default. */
  clearTuning(path: string): void {
    delete this._tuning[path];
  }

  /** Clear all advanced-tuning overrides (back to dial defaults). */
  resetTuning(): void {
    this._tuning = {};
  }

  /** Subscribe to setting changes; returns an unsubscribe fn. */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
