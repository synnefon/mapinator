import type { Vec3 } from "../common/map";
import { qMul, qNormalize, quatBetween, type Quat } from "../common/rotation";
import { clamp } from "../common/util";
import { globeRadiusPx } from "./GlobeRenderer";

export type GlobeView = { orientation: Quat; scale: number };

interface GlobeControllerConfig {
  canvas: HTMLCanvasElement;
  getView: () => GlobeView;
  setView: (view: GlobeView) => void;
  zoomSensitivity?: number;
}

const DEFAULT_ZOOM_SENS = 0.0006; // scale units per wheel delta (now geometric: ~uniform ratio/notch)
const PINCH_ZOOM_SENS = 1.2; // scale units per unit of pinch ratio change

/**
 * Arcball orbit controls. Drag rotates so the world point under the cursor stays
 * under the cursor (true direct manipulation, correct at any tilt); wheel/pinch
 * zooms toward the cursor (the point under it stays put). Both are expressed as a
 * single rotation: "spin the globe so view-direction A moves to view-direction B".
 */
export class GlobeController {
  private canvas: HTMLCanvasElement;
  private getView: () => GlobeView;
  private setView: (view: GlobeView) => void;
  private zoomSens: number;

  private dragging = false;
  private lastX = 0; // last cursor, in canvas pixels
  private lastY = 0;
  // Canvas rect, cached at gesture start (client px → canvas px).
  private rectLeft = 0;
  private rectTop = 0;
  private pxScale = 1;

  private pinchDistance: number | null = null;
  private pinchX = 0;
  private pinchY = 0;

  constructor(config: GlobeControllerConfig) {
    this.canvas = config.canvas;
    this.getView = config.getView;
    this.setView = config.setView;
    this.zoomSens = config.zoomSensitivity ?? DEFAULT_ZOOM_SENS;
    this.canvas.style.cursor = "grab";
    this.attach();
  }

  private cacheRect(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.rectLeft = rect.left;
    this.rectTop = rect.top;
    this.pxScale = this.canvas.width / rect.width; // canvas px per CSS px
  }

  private toCanvas(clientX: number, clientY: number): [number, number] {
    return [
      (clientX - this.rectLeft) * this.pxScale,
      (clientY - this.rectTop) * this.pxScale,
    ];
  }

  /** Unit sphere point (view space) under a canvas-pixel position at this radius. */
  private viewDirAt(canvasX: number, canvasY: number, radius: number): Vec3 {
    const nx = (canvasX - this.canvas.width / 2) / radius;
    const ny = -(canvasY - this.canvas.height / 2) / radius;
    const r2 = nx * nx + ny * ny;
    if (r2 >= 1) {
      const s = 1 / Math.sqrt(r2); // off the disk → clamp to the limb
      return { x: nx * s, y: ny * s, z: 0 };
    }
    return { x: nx, y: ny, z: Math.sqrt(1 - r2) };
  }

  /** Spin so the world point at view-dir `from` moves to view-dir `to`. */
  private rotateView(from: Vec3, to: Vec3): void {
    const v = this.getView();
    this.setView({
      ...v,
      orientation: qNormalize(qMul(quatBetween(from, to), v.orientation)),
    });
  }

  /** Zoom to `newScale` keeping the world point under (canvasX, canvasY) fixed. */
  private zoomAt(canvasX: number, canvasY: number, newScale: number): void {
    const v = this.getView();
    const from = this.viewDirAt(canvasX, canvasY, globeRadiusPx(this.canvas, v.scale));
    const scale = clamp(newScale, 0, 1);
    const to = this.viewDirAt(canvasX, canvasY, globeRadiusPx(this.canvas, scale));
    this.setView({
      orientation: qNormalize(qMul(quatBetween(from, to), v.orientation)),
      scale,
    });
  }

  /** Drag from the last cursor to the current one → arcball rotation. */
  private dragTo(canvasX: number, canvasY: number): void {
    const radius = globeRadiusPx(this.canvas, this.getView().scale);
    this.rotateView(
      this.viewDirAt(this.lastX, this.lastY, radius),
      this.viewDirAt(canvasX, canvasY, radius)
    );
    this.lastX = canvasX;
    this.lastY = canvasY;
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  private attach(): void {
    const c = this.canvas;

    c.addEventListener("mousedown", (e: MouseEvent) => {
      this.cacheRect();
      this.dragging = true;
      [this.lastX, this.lastY] = this.toCanvas(e.clientX, e.clientY);
      c.style.cursor = "grabbing";
    });
    window.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.dragging) return;
      const [x, y] = this.toCanvas(e.clientX, e.clientY);
      this.dragTo(x, y);
    });
    window.addEventListener("mouseup", () => {
      if (!this.dragging) return;
      this.dragging = false;
      c.style.cursor = "grab";
    });

    c.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.cacheRect();
        const [x, y] = this.toCanvas(e.clientX, e.clientY);
        this.zoomAt(x, y, this.getView().scale + e.deltaY * this.zoomSens);
      },
      { passive: false }
    );

    c.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        this.cacheRect();
        if (e.touches.length === 1) {
          this.dragging = true;
          [this.lastX, this.lastY] = this.toCanvas(
            e.touches[0].clientX,
            e.touches[0].clientY
          );
        } else if (e.touches.length === 2) {
          e.preventDefault();
          this.dragging = false;
          this.pinchDistance = this.touchDistance(e.touches[0], e.touches[1]);
          [this.pinchX, this.pinchY] = this.toCanvas(
            (e.touches[0].clientX + e.touches[1].clientX) / 2,
            (e.touches[0].clientY + e.touches[1].clientY) / 2
          );
        }
      },
      { passive: false }
    );
    c.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (e.touches.length === 1 && this.dragging) {
          e.preventDefault();
          const [x, y] = this.toCanvas(e.touches[0].clientX, e.touches[0].clientY);
          this.dragTo(x, y);
        } else if (e.touches.length === 2 && this.pinchDistance !== null) {
          e.preventDefault();
          const dist = this.touchDistance(e.touches[0], e.touches[1]);
          const ratio = dist / this.pinchDistance;
          this.pinchDistance = dist;
          // fingers apart (ratio > 1) → zoom in → scale decreases
          this.zoomAt(
            this.pinchX,
            this.pinchY,
            this.getView().scale - (ratio - 1) * PINCH_ZOOM_SENS
          );
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
