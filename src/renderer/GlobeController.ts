import type { Vec3 } from "../common/map";
import {
  qFromAxisAngle,
  qMul,
  qNormalize,
  quatBetween,
  type Quat,
} from "../common/rotation";
import { LOD } from "../common/settings";
import { clamp } from "../common/util";
import { globeRadiusPx } from "./GlobeRenderer";

export type GlobeView = { orientation: Quat; zoom: number };

interface GlobeControllerConfig {
  canvas: HTMLCanvasElement;
  getView: () => GlobeView;
  setView: (view: GlobeView) => void;
  zoomSensitivity?: number;
}

const DEFAULT_ZOOM_SENS = 0.0006; // zoom units per wheel delta (now geometric: ~uniform ratio/notch)
const PINCH_ZOOM_SENS = 1.2; // zoom units per unit of pinch ratio change

// Drag-release inertia (Google-Earth-like): a short, gentle glide you can catch.
const MOMENTUM_MAX_SPEED = 3.5; // rad/s cap, so a hard flick doesn't whip around
const MOMENTUM_TAU = 0.3; // s; exponential decay constant (~speed·TAU radians of glide, ~stops in 1s)
const MOMENTUM_MIN_START = 0.25; // rad/s; below this a release just stops (no coast)
const MOMENTUM_MIN_STOP = 0.04; // rad/s; the glide ends here
const MOMENTUM_MAX_IDLE_MS = 60; // release must closely follow a move to coast (else it's a hold)

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

  // Release inertia: smoothed angular velocity (rad/s) about velAxis, sampled during drag.
  private momentumRAF: number | null = null;
  private velAxis: Vec3 = { x: 0, y: 1, z: 0 };
  private velSpeed = 0;
  private lastMoveTime = 0; // performance.now() of the last drag move

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
    // Globe centre is shifted right by GLOBE_OFFSET_X of the width (matches the shader's
    // uOffsetX), so hit-testing must use the same shifted centre.
    const centerX = this.canvas.width * (0.5 + LOD.GLOBE_OFFSET_X);
    const nx = (canvasX - centerX) / radius;
    const ny = -(canvasY - this.canvas.height / 2) / radius;
    const r2 = nx * nx + ny * ny;
    if (r2 >= 1) {
      const s = 1 / Math.sqrt(r2); // off the disk → clamp to the limb
      return { x: nx * s, y: ny * s, z: 0 };
    }
    return { x: nx, y: ny, z: Math.sqrt(1 - r2) };
  }

  /** Zoom to `newZoom` keeping the world point under (canvasX, canvasY) fixed. */
  private zoomAt(canvasX: number, canvasY: number, newZoom: number): void {
    const v = this.getView();
    const from = this.viewDirAt(canvasX, canvasY, globeRadiusPx(this.canvas, v.zoom));
    const zoom = clamp(newZoom, 0, 1);
    const to = this.viewDirAt(canvasX, canvasY, globeRadiusPx(this.canvas, zoom));
    this.setView({
      orientation: qNormalize(qMul(quatBetween(from, to), v.orientation)),
      zoom,
    });
  }

  /** Drag from the last cursor to the current one → arcball rotation. */
  private dragTo(canvasX: number, canvasY: number): void {
    const radius = globeRadiusPx(this.canvas, this.getView().zoom);
    const from = this.viewDirAt(this.lastX, this.lastY, radius);
    const to = this.viewDirAt(canvasX, canvasY, radius);
    const dq = quatBetween(from, to);
    const v = this.getView();
    this.setView({ ...v, orientation: qNormalize(qMul(dq, v.orientation)) });
    this.trackVelocity(dq);
    this.lastX = canvasX;
    this.lastY = canvasY;
  }

  /** Update the smoothed angular velocity from the latest drag step (for release inertia). */
  private trackVelocity(dq: Quat): void {
    const now = performance.now();
    const dt = (now - this.lastMoveTime) / 1000;
    this.lastMoveTime = now;
    if (dt <= 0 || dt > 0.1) {
      this.velSpeed = 0; // first move of a drag, or a stall — no reliable velocity
      return;
    }
    const w = clamp(dq.w, -1, 1);
    const s = Math.sqrt(1 - w * w);
    if (s < 1e-6) return; // no rotation this step — keep the previous axis/speed
    this.velAxis = { x: dq.x / s, y: dq.y / s, z: dq.z / s };
    const angle = 2 * Math.acos(w);
    // EMA toward the instantaneous speed: favours recent motion, ignores single-frame spikes.
    this.velSpeed = this.velSpeed * 0.4 + (angle / dt) * 0.6;
  }

  /** Coast after release: keep spinning about the last drag axis, decaying to rest. */
  private startMomentum(): void {
    this.stopMomentum();
    if (
      this.velSpeed < MOMENTUM_MIN_START ||
      performance.now() - this.lastMoveTime > MOMENTUM_MAX_IDLE_MS
    ) {
      return;
    }
    let speed = Math.min(this.velSpeed, MOMENTUM_MAX_SPEED);
    const axis = this.velAxis;
    let last = performance.now();
    const step = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      speed *= Math.exp(-dt / MOMENTUM_TAU);
      if (speed < MOMENTUM_MIN_STOP) {
        this.momentumRAF = null;
        return;
      }
      const dq = qFromAxisAngle(axis.x, axis.y, axis.z, speed * dt);
      const v = this.getView();
      this.setView({ ...v, orientation: qNormalize(qMul(dq, v.orientation)) });
      this.momentumRAF = requestAnimationFrame(step);
    };
    this.momentumRAF = requestAnimationFrame(step);
  }

  /** Cancel any in-progress inertia — call to "catch" a coasting globe. */
  stopMomentum(): void {
    if (this.momentumRAF !== null) {
      cancelAnimationFrame(this.momentumRAF);
      this.momentumRAF = null;
    }
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  private attach(): void {
    const c = this.canvas;

    c.addEventListener("mousedown", (e: MouseEvent) => {
      this.cacheRect();
      this.stopMomentum(); // catch a coasting globe
      this.dragging = true;
      this.velSpeed = 0;
      this.lastMoveTime = performance.now();
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
      this.startMomentum();
    });

    c.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.cacheRect();
        const [x, y] = this.toCanvas(e.clientX, e.clientY);
        this.zoomAt(x, y, this.getView().zoom - e.deltaY * this.zoomSens);
      },
      { passive: false }
    );

    c.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        this.cacheRect();
        if (e.touches.length === 1) {
          this.stopMomentum();
          this.dragging = true;
          this.velSpeed = 0;
          this.lastMoveTime = performance.now();
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
          // fingers apart (ratio > 1) → zoom in → zoom increases
          this.zoomAt(
            this.pinchX,
            this.pinchY,
            this.getView().zoom + (ratio - 1) * PINCH_ZOOM_SENS
          );
        }
      },
      { passive: false }
    );
    const endTouch = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        const wasDragging = this.dragging;
        this.dragging = false;
        if (wasDragging) this.startMomentum();
      }
      if (e.touches.length < 2) this.pinchDistance = null;
    };
    c.addEventListener("touchend", endTouch);
    c.addEventListener("touchcancel", endTouch);
  }
}
