import { MAP_DEFAULTS, type MapSettings } from "./settings";

// Save-file format for a downloadable/loadable map: the seed (its name) plus the
// settings to restore. Serialize / parse / validate live here so the format has one
// home and a clean test surface, instead of being inlined in the menu's click handlers.
export const SAVE_EXTENSION = ".mapination";

export type SaveFile = { seed: string; mapSettings: MapSettings };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

/** Serialize a map (seed + settings) to a .mapination JSON string. */
export function serializeSave(seed: string, settings: MapSettings): string {
  return JSON.stringify({ seed, mapSettings: { ...settings } }, null, 2);
}

/**
 * Parse + validate a .mapination file, filling any missing fields from defaults.
 * Returns null (after alerting the user) on anything malformed.
 */
export function parseSave(text: string): SaveFile | null {
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
  if (!isRecord(raw.mapSettings)) {
    alert("save file must contain a map settings object");
    return null;
  }
  return {
    seed: raw.seed,
    mapSettings: { ...MAP_DEFAULTS, ...raw.mapSettings } as MapSettings,
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
export function openSaveFile(): Promise<SaveFile | null> {
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
