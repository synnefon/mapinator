import { Quat, type Vec3 } from "./common/3DMath";
import { globeRadiusPx } from "./renderer/GlobeRenderer";

// The one info popup shared by every tagged thing on the map (countries, cities). It's opened against a
// point on the globe and then FOLLOWS that point each frame, closing itself once the point leaves view —
// rotated behind the limb, zoomed out below its reveal level, or when its layer is switched off.
const MIN_FRONT_Z = 0.04; // closed once the anchor passes behind the visible limb
const OFFSET_PX = 16; // nudge off the anchor so the box doesn't sit on top of the marker
const PAD = 12; // viewport edge padding

export type PopupRow = [string, string];
export type PopupSource = "country" | "city";

type Anchored = { source: PopupSource; anchor: Vec3; minLevel: number };

export class InfoPopup {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private anchored: Anchored | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "info-popup";
    const close = document.createElement("button");
    close.className = "info-popup-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "close");
    close.addEventListener("click", () => this.close());
    this.titleEl = document.createElement("h3");
    this.titleEl.className = "info-popup-title";
    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "info-popup-body";
    this.root.append(close, this.titleEl, this.bodyEl);
    document.body.append(this.root);
    // Dismiss on any press outside the popup (a press on another marker re-opens it afterward).
    document.addEventListener("pointerdown", (e) => {
      if (this.anchored && !this.root.contains(e.target as Node)) this.close();
    });
  }

  /** Open (or move) the popup, anchored to a globe point. `minLevel` is the lowest LOD zoom level the
   *  tagged thing shows at, so the popup closes when you zoom out below it (0 = no lower bound). */
  open(opts: { source: PopupSource; anchor: Vec3; title: string; rows: PopupRow[]; minLevel?: number; at: { x: number; y: number } }): void {
    this.anchored = { source: opts.source, anchor: opts.anchor, minLevel: opts.minLevel ?? 0 };
    this.titleEl.textContent = opts.title;
    // Two cells per row feed the body's 2-col grid: keys form one column, values another.
    this.bodyEl.replaceChildren(
      ...opts.rows.flatMap(([label, value]) => {
        const key = document.createElement("span");
        key.className = "info-popup-key";
        key.textContent = `${label}:`;
        const val = document.createElement("span");
        val.className = "info-popup-val";
        val.textContent = value;
        return [key, val];
      })
    );
    this.root.style.display = "block";
    // Position at the click point right away so it never flashes top-left before the first follow frame.
    this.place(opts.at.x, opts.at.y);
  }

  close(): void {
    this.anchored = null;
    this.root.style.display = "none";
  }

  /** Which layer the open popup belongs to (so the caller can tell us if that layer is still visible). */
  source(): PopupSource | null {
    return this.anchored?.source ?? null;
  }

  /** Reproject + reposition each frame; close if the anchor has left view. `layerVisible` is whether the
   *  anchor's own layer is currently shown. */
  update(
    canvas: HTMLCanvasElement,
    orientation: Quat,
    zoom: number,
    offsetFraction: number,
    level: number,
    layerVisible: boolean
  ): void {
    if (!this.anchored) return;
    if (!layerVisible || level < this.anchored.minLevel) {
      this.close();
      return;
    }
    const r = Quat.rotate(orientation, this.anchored.anchor);
    if (r.z < MIN_FRONT_Z) {
      this.close();
      return;
    }
    const radius = globeRadiusPx(canvas, zoom);
    const px = canvas.width / 2 + r.x * radius + offsetFraction * canvas.width;
    const py = canvas.height / 2 - r.y * radius;
    this.place(px, py);
  }

  /** Position the popup just off a screen point, clamped to the viewport. */
  private place(ax: number, ay: number): void {
    const x = Math.min(ax + OFFSET_PX, window.innerWidth - this.root.offsetWidth - PAD);
    const y = Math.min(ay + OFFSET_PX, window.innerHeight - this.root.offsetHeight - PAD);
    this.root.style.left = `${Math.max(PAD, x)}px`;
    this.root.style.top = `${Math.max(PAD, y)}px`;
  }
}
