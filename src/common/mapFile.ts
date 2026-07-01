import type { MapState } from "../AppState";
import { Quat } from "./3DMath";
import { Languages, type Language } from "./language";
import { FEATURE_DEFAULTS, MAP_DEFAULTS, type Features, type MapSettings, type TuningOverrides } from "./settings";

const isLanguage = (v: unknown): v is Language =>
  typeof v === "string" && (Languages as readonly string[]).includes(v);

// Save-file format for a downloadable/loadable map: a full MapState (seed + settings + advanced
// tuning + camera orientation). Serialize / parse / validate live here so the format has one
// home and a clean test surface, instead of being inlined in the menu's click handlers.
export const SAVE_EXTENSION = ".mapination";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** A loaded orientation must be four finite numbers; anything else falls back to identity. */
function parseOrientation(v: unknown): Quat {
  if (isRecord(v) && isNum(v.x) && isNum(v.y) && isNum(v.z) && isNum(v.w))
    return { x: v.x, y: v.y, z: v.z, w: v.w };
  return { ...Quat.identity };
}

/**
 * Serialize a map state to a .mapination JSON string. The THEME is deliberately NOT written when
 * it's the default, so a saved map doesn't force the default theme on the loader (parseSave refills
 * it on load). Layer toggles ARE part of the saved state — the view flags ride in `settings` and the
 * generation feature switches in `features` — so a loaded map looks like the one that was saved.
 */
export function serializeSave(state: MapState): string {
  const settings: Partial<MapSettings> = { ...state.settings };
  if (settings.theme === MAP_DEFAULTS.theme) delete settings.theme;
  return JSON.stringify({ ...state, settings }, null, 2);
}

/** The saved feature switches, if the file carries a valid set: known keys with boolean values
 *  only (a hand-edited file can't inject junk). Undefined for pre-feature saves — the loader
 *  then keeps whatever switches are currently on (the old behaviour). */
function parseFeatures(v: unknown): Features | undefined {
  if (!isRecord(v)) return undefined;
  const out = { ...FEATURE_DEFAULTS };
  let any = false;
  for (const key of Object.keys(FEATURE_DEFAULTS) as (keyof Features)[]) {
    if (typeof v[key] === "boolean") {
      out[key] = v[key];
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * Parse + validate a .mapination file, filling any missing fields from defaults (so older
 * saves — seed + settings only — still load, just without tuning/orientation). Returns null
 * (after alerting the user) on anything malformed.
 */
export function parseSave(text: string): MapState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    alert("Failed to load map file.");
    return null;
  }
  if (!isRecord(raw)) {
    alert("map file must be an object");
    return null;
  }
  if (typeof raw.seed !== "string" || !raw.seed) {
    alert("save file must contain a seed");
    return null;
  }
  const rawSettings = raw.settings ?? raw.mapSettings; // `mapSettings`: older save-file field name
  if (!isRecord(rawSettings)) {
    alert("save file must contain a map settings object");
    return null;
  }
  return {
    seed: raw.seed,
    settings: { ...MAP_DEFAULTS, ...rawSettings } as MapSettings,
    tuning: isRecord(raw.tuning) ? (raw.tuning as TuningOverrides) : {},
    orientation: parseOrientation(raw.orientation),
    language: isLanguage(raw.language) ? raw.language : undefined, // omitted by pre-language saves
    features: parseFeatures(raw.features), // omitted by pre-feature-switch saves
  };
}

/** Trigger a browser download of string/blob content. */
export function downloadFile(
  content: string | Blob,
  filename: string,
  mime: string
): void {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/** Prompt for a .mapination file and read + parse it. Resolves null if cancelled or invalid. */
export function openSaveFile(): Promise<MapState | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: SAVE_EXTENSION,
    });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(parseSave(String(reader.result)));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
