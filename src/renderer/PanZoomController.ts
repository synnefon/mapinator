import type { WorldMap } from "../common/map";
import { lerp } from "../common/util";

interface PanZoomConfig {
  canvas: HTMLCanvasElement;
  onRedraw: () => void;
  getCachedMap: () => WorldMap | null;
  momentum?: number;
  onZoomChange?: (zoom: number, viewScale: number) => void;
}

export class PanZoomController {
  private canvas: HTMLCanvasElement;
  private onRedraw: () => void;
  private getCachedMap: () => WorldMap | null;
  private onZoomChange?: (zoom: number, viewScale: number) => void;
  private momentum: number;

  public panX = 0;
  public panY = 0;
  public viewScale = 1.0;
  private zoom = 0.2;

  // Drag/momentum state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;
  private velocityX = 0;
  private velocityY = 0;
  private lastMoveTime = 0;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private momentumAnimationId: number | null = null;

  // Touch/pinch state
  private isTouchPanning = false;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchPanStartX = 0;
  private touchPanStartY = 0;
  private initialPinchDistance: number | null = null;
  private initialPinchZoom: number | null = null;
  private pinchCenterX = 0;
  private pinchCenterY = 0;

  constructor(config: PanZoomConfig) {
    this.canvas = config.canvas;
    this.onRedraw = config.onRedraw;
    this.getCachedMap = config.getCachedMap;
    this.onZoomChange = config.onZoomChange;
    this.momentum = config.momentum ?? 0.3;
    this.attachEventListeners();
  }

  public setZoom(zoom: number): void {
    this.zoom = Math.max(0, Math.min(1, zoom));
    this.viewScale = lerp(1, 5, this.zoom, 0, 1);
    this.onZoomChange?.(this.zoom, this.viewScale);
  }

  public getZoom(): number {
    return this.zoom;
  }

  public resetPan(): void {
    this.panX = 0;
    this.panY = 0;
    this.stopMomentum();
  }

  private clampPanToBounds(): boolean {
    const cachedMap = this.getCachedMap();
    if (!cachedMap) return false;

    // Calculate map dimensions in canvas pixels
    const scale = (this.canvas.width / cachedMap.resolution) * this.viewScale;
    const mapWidth = cachedMap.resolution * scale;
    const mapHeight = cachedMap.resolution * scale;

    const oldPanX = this.panX;
    const oldPanY = this.panY;

    // Constrain panX: map shouldn't show blank space
    // Left edge of map shouldn't go past right edge of canvas: panX <= canvas.width
    // Right edge of map shouldn't go past left edge of canvas: panX >= -mapWidth
    // Combine: keep map visible, prevent blank space
    this.panX = Math.max(
      Math.min(this.panX, 0), // Left edge at or left of canvas left
      this.canvas.width - mapWidth // Right edge at or right of canvas right
    );

    this.panY = Math.max(
      Math.min(this.panY, 0),
      this.canvas.height - mapHeight
    );

    // Return true if clamping occurred
    return oldPanX !== this.panX || oldPanY !== this.panY;
  }

  private applyMomentum = () => {
    const friction = lerp(0.8, 0.97, this.momentum);
    const minVelocity = lerp(0.5, 0.05, this.momentum);
    const speed = Math.hypot(this.velocityX, this.velocityY);

    if (speed < minVelocity) {
      this.momentumAnimationId = null;
      return;
    }

    this.panX += this.velocityX;
    this.panY += this.velocityY;

    // Stop momentum if we hit bounds
    if (this.clampPanToBounds()) {
      this.stopMomentum();
      this.onRedraw();
      return;
    }

    this.velocityX *= friction;
    this.velocityY *= friction;

    this.onRedraw();
    this.momentumAnimationId = requestAnimationFrame(this.applyMomentum);
  };

  private startMomentum(): void {
    if (this.momentumAnimationId !== null) {
      cancelAnimationFrame(this.momentumAnimationId);
    }
    this.momentumAnimationId = requestAnimationFrame(this.applyMomentum);
  }

  private stopMomentum(): void {
    if (this.momentumAnimationId !== null) {
      cancelAnimationFrame(this.momentumAnimationId);
      this.momentumAnimationId = null;
    }
    this.velocityX = 0;
    this.velocityY = 0;
  }

  private getTouchDistance(t1: Touch, t2: Touch): number {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.hypot(dx, dy);
  }

  private getCanvasScale() {
    const rect = this.canvas.getBoundingClientRect();
    return {
      scaleX: this.canvas.width / rect.width,
      scaleY: this.canvas.height / rect.height,
      rect,
    };
  }

  private handlePan(
    dx: number,
    dy: number,
    scaleX: number,
    scaleY: number,
    panStartX: number,
    panStartY: number
  ) {
    this.panX = panStartX + dx * scaleX;
    this.panY = panStartY + dy * scaleY;
    this.clampPanToBounds();
    this.onRedraw();
  }

  private handleMomentum(
    eX: number,
    eY: number,
    scaleX: number,
    scaleY: number
  ) {
    const now = Date.now();
    const dt = now - this.lastMoveTime;
    if (dt > 0) {
      const moveX = (eX - this.lastMoveX) * scaleX;
      const moveY = (eY - this.lastMoveY) * scaleY;
      this.velocityX = (moveX / dt) * 16;
      this.velocityY = (moveY / dt) * 16;
    }
    this.lastMoveTime = now;
    this.lastMoveX = eX;
    this.lastMoveY = eY;
  }

  private handleMomentumStart() {
    const speedThreshold = lerp(5, 0.5, this.momentum);
    const speed = Math.hypot(this.velocityX, this.velocityY);
    if (speed > speedThreshold) this.startMomentum();
  }

  private attachEventListeners(): void {
    // Mouse events
    this.canvas.addEventListener("mousedown", (e: MouseEvent) => {
      this.stopMomentum();
      this.isDragging = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.panStartX = this.panX;
      this.panStartY = this.panY;
      this.lastMoveTime = Date.now();
      this.lastMoveX = e.clientX;
      this.lastMoveY = e.clientY;
      this.canvas.style.cursor = "grabbing";
    });

    this.canvas.addEventListener("mousemove", (e: MouseEvent) => {
      if (!this.isDragging) return;
      const { scaleX, scaleY } = this.getCanvasScale();
      this.handlePan(
        e.clientX - this.dragStartX,
        e.clientY - this.dragStartY,
        scaleX,
        scaleY,
        this.panStartX,
        this.panStartY
      );
      this.handleMomentum(e.clientX, e.clientY, scaleX, scaleY);
    });

    const mouseUpOrLeave = () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = "grab";
        this.handleMomentumStart();
      }
    };
    this.canvas.addEventListener("mouseup", mouseUpOrLeave);
    this.canvas.addEventListener("mouseleave", mouseUpOrLeave);

    // Scroll-to-zoom
    this.canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.stopMomentum();
      const cachedMap = this.getCachedMap();
      if (!cachedMap) return;

      const { scaleX, scaleY, rect } = this.getCanvasScale();
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;
      const oldFullScale =
        (this.canvas.width / cachedMap.resolution) * this.viewScale;
      const worldX = (mouseX - this.panX) / oldFullScale;
      const worldY = (mouseY - this.panY) / oldFullScale;

      const deltaZoom = -e.deltaY * 0.001;
      this.setZoom(this.zoom + deltaZoom);

      const newFullScale =
        (this.canvas.width / cachedMap.resolution) * this.viewScale;
      this.panX = mouseX - worldX * newFullScale;
      this.panY = mouseY - worldY * newFullScale;

      this.clampPanToBounds();
      this.onRedraw();
    });

    // Touch events
    this.canvas.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        this.stopMomentum();
        this.isTouchPanning = true;
        const touch = e.touches[0];
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.touchPanStartX = this.panX;
        this.touchPanStartY = this.panY;
        this.lastMoveTime = Date.now();
        this.lastMoveX = touch.clientX;
        this.lastMoveY = touch.clientY;
      } else if (e.touches.length === 2) {
        e.preventDefault();
        this.stopMomentum();
        this.isTouchPanning = false;
        const [touch1, touch2] = [e.touches[0], e.touches[1]];
        this.initialPinchDistance = this.getTouchDistance(touch1, touch2);
        this.initialPinchZoom = this.zoom;
        const { scaleX, scaleY, rect } = this.getCanvasScale();
        this.pinchCenterX =
          ((touch1.clientX + touch2.clientX) / 2 - rect.left) * scaleX;
        this.pinchCenterY =
          ((touch1.clientY + touch2.clientY) / 2 - rect.top) * scaleY;
      }
    });

    this.canvas.addEventListener("touchmove", (e: TouchEvent) => {
      if (e.touches.length === 1 && this.isTouchPanning) {
        e.preventDefault();
        const touch = e.touches[0];
        const { scaleX, scaleY } = this.getCanvasScale();
        this.handlePan(
          touch.clientX - this.touchStartX,
          touch.clientY - this.touchStartY,
          scaleX,
          scaleY,
          this.touchPanStartX,
          this.touchPanStartY
        );
        this.handleMomentum(touch.clientX, touch.clientY, scaleX, scaleY);
      } else if (
        e.touches.length === 2 &&
        this.initialPinchDistance !== null &&
        this.initialPinchZoom !== null
      ) {
        e.preventDefault();
        const cachedMap = this.getCachedMap();
        if (!cachedMap) return;
        const [touch1, touch2] = [e.touches[0], e.touches[1]];
        const currentDistance = this.getTouchDistance(touch1, touch2);

        const oldFullScale =
          (this.canvas.width / cachedMap.resolution) * this.viewScale;
        const worldX = (this.pinchCenterX - this.panX) / oldFullScale;
        const worldY = (this.pinchCenterY - this.panY) / oldFullScale;

        const distanceRatio = currentDistance / this.initialPinchDistance;
        const zoomDelta = (distanceRatio - 1) * 0.5;
        this.setZoom(this.initialPinchZoom + zoomDelta);

        const newFullScale =
          (this.canvas.width / cachedMap.resolution) * this.viewScale;
        this.panX = this.pinchCenterX - worldX * newFullScale;
        this.panY = this.pinchCenterY - worldY * newFullScale;

        this.clampPanToBounds();
        this.onRedraw();
      }
    });

    this.canvas.addEventListener("touchend", (e: TouchEvent) => {
      if (e.touches.length === 0) {
        if (this.isTouchPanning) {
          this.isTouchPanning = false;
          this.handleMomentumStart();
        }
        this.initialPinchDistance = null;
        this.initialPinchZoom = null;
      } else if (e.touches.length < 2) {
        this.initialPinchDistance = null;
        this.initialPinchZoom = null;
      }
    });
  }
}
