import { Quat, type Vec3 } from "../common/3DMath";
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
const CLICK_DRAG_SLOP = 4; // px of pointer travel before a press counts as a drag (and suppresses the click)

// Drag-release inertia (Google-Earth-like): a short, gentle glide you can catch.
const MOMENTUM_MAX_SPEED = 3.5; // rad/s cap, so a hard flick doesn't whip around
const MOMENTUM_TAU = 0.3; // s; exponential decay constant (~speed·TAU radians of glide, ~stops in 1s)
const MOMENTUM_MIN_START = 0.25; // rad/s; below this a release just stops (no coast)
const MOMENTUM_MIN_STOP = 0.04; // rad/s; the glide ends here
const MOMENTUM_MAX_IDLE_MS = 60; // release must closely follow a move to coast (else it's a hold)

/** Presses on map-overlay controls (e.g. the north button) keep their own behaviour and don't grab the
 *  globe; everything else over the map — including the interactive country/city labels — pans + zooms. */
const isMapControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(".map-overlay-btn") !== null;

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
  // Press position (client px) + whether the gesture has travelled past CLICK_DRAG_SLOP — to tell a click
  // (opens a country/city popup) from a drag (pans, and must NOT open the popup on release).
  private downClientX = 0;
  private downClientY = 0;
  private movedSinceDown = false;
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
    // Globe centre is shifted right by GLOBE_OFFSET_FRACTION of the width (matches the shader's
    // uOffsetX), so hit-testing must use the same shifted centre.
    const centerX = this.canvas.width * (0.5 + LOD.GLOBE_OFFSET_FRACTION);
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
      orientation: Quat.normalize(Quat.mul(Quat.between(from, to), v.orientation)),
      zoom,
    });
  }

  /** Drag from the last cursor to the current one → arcball rotation. */
  private dragTo(canvasX: number, canvasY: number): void {
    const radius = globeRadiusPx(this.canvas, this.getView().zoom);
    const from = this.viewDirAt(this.lastX, this.lastY, radius);
    const to = this.viewDirAt(canvasX, canvasY, radius);
    const dq = Quat.between(from, to);
    const v = this.getView();
    this.setView({ ...v, orientation: Quat.normalize(Quat.mul(dq, v.orientation)) });
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
      const dq = Quat.fromAxisAngle(axis.x, axis.y, axis.z, speed * dt);
      const v = this.getView();
      this.setView({ ...v, orientation: Quat.normalize(Quat.mul(dq, v.orientation)) });
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

  /** Flag the gesture as a drag once the pointer travels past CLICK_DRAG_SLOP (client px). */
  private trackMovement(clientX: number, clientY: number): void {
    if (this.movedSinceDown) return;
    if (Math.hypot(clientX - this.downClientX, clientY - this.downClientY) > CLICK_DRAG_SLOP) {
      this.movedSinceDown = true;
    }
  }

  private attach(): void {
    const c = this.canvas;
    // Listen on the frame (the canvas's parent), not the canvas itself: the interactive country/city
    // labels are sibling DOM nodes layered above the canvas, so a press/scroll that lands on a label never
    // reaches the canvas — but it does bubble to their shared parent. Driving the controls from there lets
    // you pan + zoom with the cursor over a label, while the label keeps its own hover/click. The
    // coordinate math stays on the canvas, which owns the globe geometry.
    const target = c.parentElement ?? c;

    target.addEventListener("mousedown", (e: MouseEvent) => {
      this.movedSinceDown = false;
      this.downClientX = e.clientX;
      this.downClientY = e.clientY;
      if (isMapControl(e.target)) return; // a button press is its own gesture, not a globe grab
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
      this.trackMovement(e.clientX, e.clientY);
      const [x, y] = this.toCanvas(e.clientX, e.clientY);
      this.dragTo(x, y);
    });
    window.addEventListener("mouseup", () => {
      if (!this.dragging) return;
      this.dragging = false;
      c.style.cursor = "grab";
      this.startMomentum();
    });

    // A drag that ends over a label/marker would otherwise fire that element's click (opening its popup).
    // Swallow that click in the capture phase — before the label sees it — whenever the gesture actually
    // moved. A true click (press + release in place) never trips the threshold, so it still opens the popup.
    target.addEventListener(
      "click",
      (e: MouseEvent) => {
        if (!this.movedSinceDown) return;
        e.stopPropagation();
        this.movedSinceDown = false;
      },
      true
    );

    target.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.cacheRect();
        const [x, y] = this.toCanvas(e.clientX, e.clientY);
        this.zoomAt(x, y, this.getView().zoom - e.deltaY * this.zoomSens);
      },
      { passive: false }
    );

    target.addEventListener(
      "touchstart",
      (e: TouchEvent) => {
        this.movedSinceDown = false;
        if (isMapControl(e.target)) return; // a button tap is its own gesture, not a globe grab
        this.cacheRect();
        if (e.touches.length === 1) {
          this.downClientX = e.touches[0].clientX;
          this.downClientY = e.touches[0].clientY;
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
    target.addEventListener(
      "touchmove",
      (e: TouchEvent) => {
        if (e.touches.length === 1 && this.dragging) {
          e.preventDefault();
          this.trackMovement(e.touches[0].clientX, e.touches[0].clientY);
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
    target.addEventListener("touchend", endTouch);
    target.addEventListener("touchcancel", endTouch);
  }
}
