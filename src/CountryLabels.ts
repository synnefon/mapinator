import { Quat } from "./common/3DMath";
import { languageName } from "./common/language";
import type { CountryInfo } from "./mapgen/features";
import { globeRadiusPx } from "./renderer/GlobeRenderer";

// Country names are interactive DOM elements (so hover/click come for free) layered over the globe,
// repositioned each frame by projecting their anchor — same projection as the canvas overlays.
const MIN_FRONT_Z = 0.04; // hide labels at/behind the visible limb
const FONT_FRAC = 0.5; // font px as a fraction of the country's on-screen radius (matches the old canvas size)
const MIN_FONT_PX = 13; // a touch larger than the white geographic labels (11–34)
const MAX_FONT_PX = 42;
const ZOOM_OUT_SCALE = 0.5; // smaller on the whole-globe view, full size by ZOOM_FULL
const ZOOM_FULL = 0.5;
const KM2_PER_MI2 = 2.589988;

type PopupEls = { root: HTMLElement; title: HTMLElement; body: HTMLElement };

/**
 * Manages the interactive country-name layer: a positioned `<div>` per country (hover → territory
 * highlight via `onHover`; click → an info popup with land area + language) plus the popup itself.
 */
export class CountryLabels {
  private readonly frame: HTMLElement;
  private readonly onHover: (index: number | null) => void;
  private readonly divs: HTMLDivElement[] = [];
  private popup: PopupEls | null = null;
  private visible = false;

  constructor(frame: HTMLElement, opts: { onHover: (index: number | null) => void }) {
    this.frame = frame;
    this.onHover = opts.onHover;
    // Dismiss the popup on any press outside it (a press on another label re-opens it afterward).
    document.addEventListener("pointerdown", (e) => {
      if (this.popup?.root.style.display === "block" && !this.popup.root.contains(e.target as Node)) {
        this.closePopup();
      }
    });
  }

  /** Rebuild the label DOM for a new country set (called when the cached map result changes). */
  setCountries(countries: CountryInfo[]): void {
    for (const d of this.divs) d.remove();
    this.divs.length = 0;
    this.closePopup();
    for (const info of countries) {
      const div = document.createElement("div");
      div.className = "country-label";
      div.textContent = info.name;
      div.style.display = "none";
      div.addEventListener("mouseenter", () => this.visible && this.onHover(info.index));
      div.addEventListener("mouseleave", () => this.visible && this.onHover(null));
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openPopup(info, e.clientX, e.clientY);
      });
      this.frame.append(div);
      this.divs.push(div);
    }
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      for (const d of this.divs) d.style.display = "none";
      this.closePopup();
    }
  }

  /** Reproject + reposition every label. The canvas is in 1:1 px with the frame, so its projected
   *  coordinates place the divs directly. Labels behind the limb are hidden. */
  update(canvas: HTMLCanvasElement, countries: CountryInfo[], orientation: Quat, zoom: number, offsetFraction: number): void {
    if (!this.visible) return;
    const radius = globeRadiusPx(canvas, zoom);
    const offX = offsetFraction * canvas.width;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const zoomScale = ZOOM_OUT_SCALE + (1 - ZOOM_OUT_SCALE) * Math.min(1, zoom / ZOOM_FULL);
    for (let i = 0; i < this.divs.length; i++) {
      const div = this.divs[i];
      const info = countries[i];
      const r = Quat.rotate(orientation, info.anchor);
      if (r.z < MIN_FRONT_Z) {
        div.style.display = "none";
        continue;
      }
      const fontPx = Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, info.extent * radius * FONT_FRAC) * zoomScale);
      div.style.left = `${cx + r.x * radius + offX}px`;
      div.style.top = `${cy - r.y * radius}px`;
      div.style.fontSize = `${fontPx}px`;
      div.style.display = "block";
    }
  }

  private formatArea(km2: number): string {
    const mi2 = km2 / KM2_PER_MI2;
    if (mi2 >= 1_000_000) {
      return `${(mi2 / 1_000_000).toFixed(1)} million mi²`;
    } else if (mi2 >= 1_000) {
      return `${(mi2 / 1_000).toFixed(1)} thousand mi²`;
    } else {
      return `${Math.round(mi2).toLocaleString()} mi²`;
    }
  }

  private formatPopulation(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)} thousand`;
    return n.toLocaleString();
  }

  private openPopup(info: CountryInfo, clientX: number, clientY: number): void {
    const p = this.popup ?? this.buildPopup();
    p.title.textContent = info.name;
    // One row per stat — add a tuple here to surface another fact (extensible by design).
    const rows: [string, string][] = [
      ["government", info.government],
      ["language", languageName(info.language)],
      ["land area", this.formatArea(info.areaKm2)],
      ["population", this.formatPopulation(info.population)],
    ];
    // Two cells per row feed the body's 2-col grid: keys form one left-aligned column, values another.
    p.body.replaceChildren(
      ...rows.flatMap(([label, value]) => {
        const key = document.createElement("span");
        key.className = "country-popup-key";
        key.textContent = `${label}:`;
        const val = document.createElement("span");
        val.className = "country-popup-val";
        val.textContent = value;
        return [key, val];
      })
    );
    p.root.style.display = "block";
    // Clamp to the viewport now that it has a measured size.
    const pad = 12;
    const x = Math.min(clientX + pad, window.innerWidth - p.root.offsetWidth - pad);
    const y = Math.min(clientY + pad, window.innerHeight - p.root.offsetHeight - pad);
    p.root.style.left = `${Math.max(pad, x)}px`;
    p.root.style.top = `${Math.max(pad, y)}px`;
  }

  private closePopup(): void {
    if (this.popup) this.popup.root.style.display = "none";
  }

  private buildPopup(): PopupEls {
    const root = document.createElement("div");
    root.className = "country-popup";
    const close = document.createElement("button");
    close.className = "country-popup-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "close");
    close.addEventListener("click", () => this.closePopup());
    const title = document.createElement("h3");
    title.className = "country-popup-title";
    const body = document.createElement("div");
    body.className = "country-popup-body";
    root.append(close, title, body);
    document.body.append(root);
    this.popup = { root, title, body };
    return this.popup;
  }
}
