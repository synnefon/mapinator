import type { AppState } from "./AppState";
import { MAPINATION_FILE_EXTENSION } from "./common/constants";
import {
  isValidSaveFile,
  MAP_DEFAULTS,
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
  loadMap: (name: string) => void;
  loadNewMap: (name: string) => void;
  downloadPNG: (title: string) => void;
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

const downloadFile = (c: string | Blob, fname: string, m: string) => {
  const blob = c instanceof Blob ? c : new Blob([c], { type: m });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fname;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};

/** Wire up the left-sidebar menu: title, tools toggle, sliders, theme, and IO buttons. */
export function setupMenuBar(deps: MenuBarDeps): MenuBarHandles {
  const {
    appState,
    ui,
    needle,
    generateMapName,
    drawMap,
    ensureMap,
    clearMapCache,
    loadMap,
    loadNewMap,
    downloadPNG,
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
    ui.updateSliderValue(def.key, Number(appState.settings[def.key]));
    slider.input.addEventListener("input", () => {
      let v = Number(slider.input.value);
      if (!Number.isFinite(v)) v = Number(MAP_DEFAULTS[def.key]);
      v = Math.max(def.min, Math.min(def.max, v));
      appState.updateSetting(def.key, v as (typeof appState.settings)[typeof def.key]);
      ui.updateSliderValue(def.key, v);
      drawMap();
    });
  });

  // --- Theme ---
  ui.themeRadios.forEach((radio) => {
    radio.checked = radio.value === appState.settings.theme;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        appState.updateSetting("theme", radio.value as MapSettings["theme"]);
        applyThemeUIColors(radio.value as MapSettings["theme"]);
        needle?.recolor();
        drawMap();
      }
    });
  });
  applyThemeUIColors(appState.settings.theme);
  needle?.recolor();

  // --- Button handlers ---
  regenBtn.addEventListener("click", () => {
    playEffect(regenBtnImg, "spin");
    loadNewMap(generateMapName());
  });

  resetSlidersBtn.addEventListener("click", () => {
    fadeOut(resetSlidersBtn);
    sliderDefs.forEach((d) => appState.updateSetting(d.key, MAP_DEFAULTS[d.key]));
    sliderDefs.forEach((def) =>
      ui.updateSliderValue(def.key, Number(appState.settings[def.key]))
    );
    clearMapCache();
    ensureMap();
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
    const mapTitleText = mapTitle.value || "Untitled Map";
    const json = JSON.stringify(
      {
        seed: appState.mapName,
        mapSettings: { ...appState.settings },
      },
      null,
      2
    );
    downloadFile(
      json,
      `${mapTitleText.replace(/\s+/g, "_")}${MAPINATION_FILE_EXTENSION}`,
      "application/json"
    );
  };

  const onLoadSave = (evt: ProgressEvent<FileReader>) => {
    let saveFile: { seed: string; mapSettings: MapSettings };
    try {
      saveFile = JSON.parse(evt.target?.result as string);
    } catch {
      alert("Failed to load map file.");
      return;
    }
    if (saveFile.mapSettings) {
      saveFile.mapSettings = { ...MAP_DEFAULTS, ...saveFile.mapSettings };
    }
    if (!isValidSaveFile(saveFile)) return;
    appState.settings = saveFile.mapSettings;
    ui.themeRadios.forEach(
      (radio) => (radio.checked = radio.value === saveFile.mapSettings.theme)
    );
    applyThemeUIColors(saveFile.mapSettings.theme);
    needle?.recolor();
    loadMap(saveFile.seed);
  };

  const handleUpload = () => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: MAPINATION_FILE_EXTENSION,
    });
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = onLoadSave;
      reader.readAsText(file);
    };
    input.click();
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

  return { setToolsCollapsed, setTitle };
}
