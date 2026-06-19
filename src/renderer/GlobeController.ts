import { clamp } from "../common/util";
import { globeRadiusPx } from "./GlobeRenderer";

export type GlobeView = { yaw: number; pitch: number; scale: number };

interface GlobeControllerConfig {
  canvas: HTMLCanvasElement;
  getView: () => GlobeView;
  setView: (view: GlobeView) => void;
  rotateSensitivity?: number;
  zoomSensitivity?: number;
}

const PITCH_LIMIT = 1.4; // ~80°; keeps the globe from tumbling over the poles
const DEFAULT_ROTATE_GAIN = 1; // overall rotate speed (≈1 ≈ cursor-tracking at scale=1)
const ROTATE_ZOOM_DAMP = 0.6; // 0 = constant angular speed, 1 = full cursor-following
const DEFAULT_ZOOM_SENS = 0.0012; // scale units per unit of wheel delta
const PINCH_ZOOM_SENS = 1.2; // scale units per unit of pinch ratio change

/**
 * Orbit controls for the globe: drag (mouse or one finger) rotates, wheel /
 * trackpad scroll / pinch zooms. Reads + writes the view via callbacks; it never
 * touches geometry, so a change only re-projects (cheap), never regenerates.
 */
export class GlobeController {
  private canvas: HTMLCanvasElement;
  private getView: () => GlobeView;
  private setView: (view: GlobeView) => void;
  private rotateSens: number;
  private zoomSens: number;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pxScale = 1; // canvas px per CSS px, captured on drag start

  private pinchDistance: number | null = null;
  private pinchStartScale = 0;

  constructor(config: GlobeControllerConfig) {
    this.canvas = config.canvas;
    this.getView = config.getView;
    this.setView = config.setView;
    this.rotateSens = config.rotateSensitivity ?? DEFAULT_ROTATE_GAIN;
    this.zoomSens = config.zoomSensitivity ?? DEFAULT_ZOOM_SENS;
    this.canvas.style.cursor = "grab";
    this.attach();
  }

  /** Drag → rotate, with a "grab" feel (the point under the cursor follows it). */
  private rotateBy(dxPx: number, dyPx: number): void {
    const v = this.getView();
    // Mouse deltas are CSS px but the globe radius is in canvas px — convert via
    // pxScale. Compensate for zoom only PARTIALLY (ROTATE_ZOOM_DAMP) so a drag
    // tracks the surface without going uselessly slow when zoomed in.
    const refRadius = globeRadiusPx(this.canvas, 1);
    const zoomFactor = globeRadiusPx(this.canvas, v.scale) / refRadius;
    const k =
      ((this.rotateSens * this.pxScale) / refRadius) *
      Math.pow(zoomFactor, -ROTATE_ZOOM_DAMP);
    this.setView({
      ...v,
      yaw: v.yaw + dxPx * k,
      pitch: clamp(v.pitch + dyPx * k, -PITCH_LIMIT, PITCH_LIMIT),
    });
  }

  /** Set globe zoom (clamped to the slider range). scale=1 = whole planet. */
  private setScale(scale: number): void {
    const v = this.getView();
    this.setView({ ...v, scale: clamp(scale, 0, 1) });
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  private attach(): void {
    const c = this.canvas;

    c.addEventListener("mousedown", (e: MouseEvent) => {
      this.dragging = true;
      this.pxScale = c.width / c.getBoundingClientRect().width;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.style.cursor = "grabbing";
    });
    // On window so a drag keeps working past the canvas edge.
    window.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.dragging) return;
      this.rotateBy(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener("mouseup", () => {
      if (!this.dragging) return;
      this.dragging = false;
      c.style.cursor = "grab";
    });

    // Wheel / trackpad two-finger scroll / pinch → zoom. Scroll up = zoom in.
    c.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.setScale(this.getView().scale + e.deltaY * this.zoomSens);
      },
      { passive: false }
    );

    // Touch: one finger rotates, two fingers pinch-zoom.
    c.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        if (e.touches.length === 1) {
          this.dragging = true;
          this.pxScale = c.width / c.getBoundingClientRect().width;
          this.lastX = e.touches[0].clientX;
          this.lastY = e.touches[0].clientY;
        } else if (e.touches.length === 2) {
          e.preventDefault();
          this.dragging = false;
          this.pinchDistance = this.touchDistance(e.touches[0], e.touches[1]);
          this.pinchStartScale = this.getView().scale;
        }
      },
      { passive: false }
    );
    c.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (e.touches.length === 1 && this.dragging) {
          e.preventDefault();
          const t = e.touches[0];
          this.rotateBy(t.clientX - this.lastX, t.clientY - this.lastY);
          this.lastX = t.clientX;
          this.lastY = t.clientY;
        } else if (e.touches.length === 2 && this.pinchDistance !== null) {
          e.preventDefault();
          const dist = this.touchDistance(e.touches[0], e.touches[1]);
          const ratio = dist / this.pinchDistance;
          // fingers apart (ratio > 1) → zoom in → scale decreases
          this.setScale(this.pinchStartScale - (ratio - 1) * PINCH_ZOOM_SENS);
        }
      },
      { passive: false }
    );
    const endTouch = (e: TouchEvent) => {
      if (e.touches.length === 0) this.dragging = false;
      if (e.touches.length < 2) this.pinchDistance = null;
    };
    c.addEventListener("touchend", endTouch);
    c.addEventListener("touchcancel", endTouch);
  }
}
