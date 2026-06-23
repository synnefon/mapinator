import { setupAdvancedPanel } from "./AdvancedSettings";
import type { AppState, MapState } from "./AppState";
import {
  downloadFile,
  openSaveFile,
  SAVE_EXTENSION,
  serializeSave,
} from "./common/mapFile";
import {
  FEATURE_DEFAULTS,
  FEATURES,
  MAP_DEFAULTS,
  TUNING_PATHS,
  tuningDefault,
  type MapSettings,
} from "./common/settings";
import { applyThemeUIColors } from "./common/themeColors";
import type { CompassNeedle } from "./renderer/compassNeedle";
import { sliderDefs, type UIManager } from "./UIManager";

// Map titles are capped at this length: generated names retry/truncate to fit (see main.ts),
// and the input blocks typing past it.
export const MAX_TITLE_LEN = 21;

// What the menu needs from main: app state + the map/render callbacks its controls trigger.
type MenuBarDeps = {
  appState: AppState;
  ui: UIManager;
  needle: CompassNeedle | null;
  generateMapName: () => string;
  drawMap: () => void;
  ensureMap: (eager?: boolean) => void;
  clearMapCache: () => void;
  loadNewMap: (name: string) => void;
  loadSavedMap: (state: MapState) => void;
  downloadPNG: (title: string) => void;
  applyAdvancedTuning: () => void;
};

// What main calls back into: auto-collapse on a map zoom gesture (setView), and show a title
// in the input (redraw).
type MenuBarHandles = {
  setToolsCollapsed: (collapsed: boolean) => void;
  setTitle: (name: string) => void;
};

// Replay a one-shot CSS animation by toggling its class (force reflow between).
const playEffect = (el: HTMLElement, effect: "bounce" | "spin") => {
  el.classList.remove(effect);
  void el.offsetWidth;
  el.classList.add(effect);
};

const fadeOut = (btn: HTMLButtonElement) => {
  btn.classList.add("clicked");
  requestAnimationFrame(() => {
    btn.classList.add("enable-transition");
    setTimeout(() => {
      btn.classList.remove("clicked");
      const off = (e: { propertyName: string }) => {
        if (e.propertyName === "background-color") {
          btn.classList.remove("enable-transition");
          btn.removeEventListener("transitionend", off);
        }
      };
      btn.addEventListener("transitionend", off);
    }, 222);
  });
};

/** Wire up the left-sidebar menu: title, tools toggle, sliders, theme, and IO buttons. */
export function setupMenuBar(deps: MenuBarDeps): MenuBarHandles {
  const {
    appState,
    ui,
    needle,
    generateMapName,
    drawMap,
    loadNewMap,
    loadSavedMap,
    downloadPNG,
    applyAdvancedTuning,
  } = deps;

  const {
    mapTitle,
    regenBtn,
    regenBtnImg,
    resetSlidersBtn,
    loadTitleBtn,
    loadTitleBtnImg,
    downloadBtn,
    uploadBtn,
    downloadPNGBtn,
    downloadSaveBtn,
    cancelPopupBtn,
    saveSettingsBtn,
    confirmSaveSettingsBtn,
    cancelSaveSettingsBtn,
  } = ui.getAllElements();

  mapTitle.maxLength = MAX_TITLE_LEN; // block typing past the limit

  // --- Title ---
  // Shrink the title font (down to a floor) so the title + check never overflow the menu bar.
  const MAX_TITLE_FONT_EM = 2.4;
  const MIN_TITLE_FONT_PX = 12;
  const fitTitleFont = () => {
    const rootPx =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = MAX_TITLE_FONT_EM * rootPx;
    mapTitle.style.fontSize = `${maxPx}px`;
    const avail = mapTitle.clientWidth; // flex-allocated width (no horizontal padding)
    const needed = mapTitle.scrollWidth; // text width at the max font
    if (needed > avail && avail > 0) {
      // Monospace width scales with font size, so one proportional step fits it.
      const px = Math.max(MIN_TITLE_FONT_PX, ((maxPx * avail) / needed) * 0.97);
      mapTitle.style.fontSize = `${px}px`;
    }
  };
  mapTitle.addEventListener("input", fitTitleFont);
  window.addEventListener("resize", fitTitleFont);
  document.fonts?.ready.then(fitTitleFont); // re-fit once the title font has loaded

  const setTitle = (name: string) => {
    mapTitle.value = name;
    fitTitleFont(); // new title → re-fit the font to the menu width
  };

  // --- Tools toggle ---
  // Tools sidebar floats above the map; collapsible any time via the toggle, and auto
  // opened/closed when a MAP zoom gesture crosses globe↔detail (see main.ts setView). The
  // glyph points the way it'll move: "<" collapses, ">" opens.
  const toolsToggle = document.getElementById("toolsToggle");
  const setToolsCollapsed = (collapsed: boolean) => {
    document.body.classList.toggle("tools-collapsed", collapsed);
    if (toolsToggle) toolsToggle.textContent = collapsed ? ">" : "<";
  };
  toolsToggle?.addEventListener("click", () =>
    setToolsCollapsed(!document.body.classList.contains("tools-collapsed"))
  );

  // --- Sliders ---
  sliderDefs.forEach((def) => {
    const slider = ui.getSlider(def.key);
    ui.updateSliderValue(def.key, Number(appState.settings[def.key])); // initial paint
    slider.input.addEventListener("input", () => {
      let v = Number(slider.input.value);
      if (!Number.isFinite(v)) v = Number(MAP_DEFAULTS[def.key]);
      v = Math.max(def.min, Math.min(def.max, v));
      appState.setSetting(def.key, v); // subscriber syncs the label
      drawMap();
    });
  });

  // --- Advanced settings ---
  // Collapsible panel of sliders for every generation/appearance dial (settings.ts).
  // Slider input writes the override into app state; applyAdvancedTuning regenerates.
  const advanced = setupAdvancedPanel({ appState, onChange: applyAdvancedTuning, onViewChange: drawMap });

  // --- Theme ---
  ui.themeRadios.forEach((radio) => {
    radio.checked = radio.value === appState.settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        appState.setSetting("theme", radio.value as MapSettings["theme"]); // subscriber recolors
        drawMap();
      }
    });
  });
  applyThemeUIColors(appState.settings.theme); // initial paint
  needle?.recolor();

  // --- Button handlers ---
  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    loadNewMap(generateMapName());
  });

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);
    sliderDefs.forEach((d) => appState.setSetting(d.key, MAP_DEFAULTS[d.key])); // subscriber syncs labels
    appState.resetTuning(); // clear advanced overrides too
    Object.assign(FEATURES, FEATURE_DEFAULTS); // turn all layers back on
    advanced.refresh(); // sync the advanced sliders + layer toggles back to their defaults
    applyAdvancedTuning(); // re-apply (now-default) dials + features everywhere + regenerate
  });

  loadTitleBtn.addEventListener("click", () => {
    playEffect(loadTitleBtnImg, "bounce");
    loadNewMap(mapTitle.value.trim());
  });

  mapTitle.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = mapTitle.value.trim();
      if (val.toUpperCase() !== appState.mapName) {
        loadNewMap(val);
        playEffect(loadTitleBtnImg, "bounce");
        setTimeout(() => mapTitle.blur(), 400);
      }
    }
  });

  // --- Download / Upload ---
  const handleDownloadSave = () => {
    const title = mapTitle.value || "Untitled Map";
    downloadFile(
      serializeSave(appState.snapshot()),
      `${title.replace(/\s+/g, "_")}${SAVE_EXTENSION}`,
      "application/json"
    );
  };

  // Apply a loaded save: loadSavedMap restores the snapshot (settings + tuning + orientation +
  // seed) and regenerates; we only sync the theme radios here, since they're not driven by the
  // store's subscriber.
  const applySave = (save: MapState) => {
    loadSavedMap(save);
    ui.themeRadios.forEach(
      (radio) => (radio.checked = radio.value === save.settings.theme)
    );
  };

  const handleUpload = async () => {
    const save = await openSaveFile();
    if (save) applySave(save);
  };

  // --- Popup management ---
  const popupBackdrop = document.getElementById("popupBackdrop");
  const handleCancelPopup = () => {
    if (popupBackdrop) popupBackdrop.classList.remove("show");
    document.removeEventListener("keydown", escHandler);
    document.removeEventListener("click", clickHandler);
  };
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") handleCancelPopup();
  };
  const clickHandler = (e: MouseEvent) => {
    if (e.target === popupBackdrop) handleCancelPopup();
  };
  if (popupBackdrop) {
    new MutationObserver((muts) =>
      muts.forEach(
        (m) =>
          m.attributeName === "class" &&
          popupBackdrop.classList.contains("show") &&
          (document.addEventListener("keydown", escHandler),
          popupBackdrop.addEventListener("click", clickHandler))
      )
    ).observe(popupBackdrop, { attributes: true });
  }

  downloadBtn.addEventListener("click", () => {
    playEffect(downloadBtn, "bounce");
    popupBackdrop && popupBackdrop.classList.add("show");
  });
  uploadBtn.addEventListener("click", () => {
    playEffect(uploadBtn, "bounce");
    handleUpload();
  });
  downloadPNGBtn.addEventListener("click", () => {
    downloadPNG(mapTitle.value || "Untitled Map");
    handleCancelPopup();
  });
  downloadSaveBtn.addEventListener("click", () => {
    handleDownloadSave();
    handleCancelPopup();
  });
  cancelPopupBtn.addEventListener("click", handleCancelPopup);

  // --- Dev-only: save current dials → settings.ts (local server only) ---
  // The /tune/save endpoint exists only in the dev server (and is loopback-guarded), so the button
  // is revealed only when we're actually running on it — production builds never show it (the DEV
  // guard is statically false there, so this whole block is dropped). Clicking opens a confirmation
  // popup; confirming overwrites settings.ts with the live dial values (then Vite hot-reloads it).
  type SaveResponse = { ok: boolean; error?: string };
  const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (import.meta.env.DEV && LOOPBACK_HOSTS.has(location.hostname)) {
    const savePopup = document.getElementById("saveSettingsPopup");
    const saveEsc = (e: KeyboardEvent) => e.key === "Escape" && closeSavePopup();
    const saveBackdrop = (e: MouseEvent) => e.target === savePopup && closeSavePopup();
    const closeSavePopup = () => {
      savePopup?.classList.remove("show");
      document.removeEventListener("keydown", saveEsc);
      savePopup?.removeEventListener("click", saveBackdrop);
    };
    const openSavePopup = () => {
      savePopup?.classList.add("show");
      document.addEventListener("keydown", saveEsc);
      savePopup?.addEventListener("click", saveBackdrop);
    };

    // Overwrite settings.ts with the current value of every dial (override, else its default).
    const writeSettings = async () => {
      console.log("writeSettings");
      const values = TUNING_PATHS.map((path) => ({
        path,
        value: appState.tuningOverrides[path] ?? tuningDefault(path),
      }));
      console.table(values);
      confirmSaveSettingsBtn.disabled = true;
      try {
        const res = await fetch("/tune/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values }),
        });
        const json = (await res.json()) as SaveResponse;
        if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        closeSavePopup();
        fadeOut(saveSettingsBtn); // flash confirmation; Vite then hot-reloads the rewritten file
      } catch (e) {
        alert(`save failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        confirmSaveSettingsBtn.disabled = false;
      }
    };

    saveSettingsBtn.classList.remove("dev-only"); // reveal on the dev server
    saveSettingsBtn.addEventListener("click", openSavePopup);
    confirmSaveSettingsBtn.addEventListener("click", writeSettings);
    cancelSaveSettingsBtn.addEventListener("click", closeSavePopup);
  }

  return { setToolsCollapsed, setTitle };
}
