import { lerp } from "../common/util";
import type { Map } from "../common/map";

interface PanZoomConfig {
  canvas: HTMLCanvasElement;
  onRedraw: () => void;
  getCachedMap: () => Map | null;
  momentum?: number;
  onZoomChange?: (zoom: number, viewScale: number) => void;
}

export class PanZoomController {
  // Canvas reference
  private canvas: HTMLCanvasElement;
  private onRedraw: () => void;
  private getCachedMap: () => Map | null;
  private onZoomChange?: (zoom: number, viewScale: number) => void;

  // Pan/zoom state
  public panX = 0;
  public panY = 0;
  public viewScale = 1.0;
  private zoom = 0.2; // Internal zoom value [0,1]

  // Drag state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  // Momentum state
  private velocityX = 0;
  private velocityY = 0;
  private lastMoveTime = 0;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private momentumAnimationId: number | null = null;
  private momentum: number;

  // Touch panning state
  private touchStartX = 0;
  private touchStartY = 0;
  private touchPanStartX = 0;
  private touchPanStartY = 0;
  private isTouchPanning = false;

  // Pinch-to-zoom state
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
    if (this.onZoomChange) {
      this.onZoomChange(this.zoom, this.viewScale);
    }
  }

  public getZoom(): number {
    return this.zoom;
  }

  public resetPan(): void {
    this.panX = 0;
    this.panY = 0;
    this.stopMomentum();
  }

  private applyMomentum = () => {
    // Derive friction and threshold from momentum parameter
    const friction = lerp(0.8, 0.97, this.momentum);
    const minVelocity = lerp(0.5, 0.05, this.momentum);

    const speed = Math.sqrt(
      this.velocityX * this.velocityX + this.velocityY * this.velocityY
    );
    if (speed < minVelocity) {
      this.momentumAnimationId = null;
      return;
    }

    this.panX += this.velocityX;
    this.panY += this.velocityY;
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

  private getTouchDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private attachEventListeners(): void {
    // Mouse event handlers for panning
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

      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;

      // Convert display pixels to canvas internal pixels
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;

      this.panX = this.panStartX + dx * scaleX;
      this.panY = this.panStartY + dy * scaleY;

      // Track velocity for momentum
      const now = Date.now();
      const dt = now - this.lastMoveTime;
      if (dt > 0) {
        const moveX = (e.clientX - this.lastMoveX) * scaleX;
        const moveY = (e.clientY - this.lastMoveY) * scaleY;
        this.velocityX = (moveX / dt) * 16; // Normalize to ~60fps
        this.velocityY = (moveY / dt) * 16;
      }
      this.lastMoveTime = now;
      this.lastMoveX = e.clientX;
      this.lastMoveY = e.clientY;

      this.onRedraw();
    });

    this.canvas.addEventListener("mouseup", () => {
      this.isDragging = false;
      this.canvas.style.cursor = "grab";

      // Start momentum if there's significant velocity
      const speedThreshold = lerp(5, 0.5, this.momentum);
      const speed = Math.sqrt(
        this.velocityX * this.velocityX + this.velocityY * this.velocityY
      );
      if (speed > speedThreshold) {
        this.startMomentum();
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = "grab";

        const speedThreshold = lerp(5, 0.5, this.momentum);
        const speed = Math.sqrt(
          this.velocityX * this.velocityX + this.velocityY * this.velocityY
        );
        if (speed > speedThreshold) {
          this.startMomentum();
        }
      }
    });

    // Scroll-to-zoom
    this.canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.stopMomentum();

      const cachedMap = this.getCachedMap();
      if (!cachedMap) return;

      const rect = this.canvas.getBoundingClientRect();

      // Convert display pixels to canvas internal pixels
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      // Calculate full scale factor (base map scale * view zoom)
      const oldFullScale = (this.canvas.width / cachedMap.resolution) * this.viewScale;

      // Calculate world position under mouse before zoom
      const worldX = (mouseX - this.panX) / oldFullScale;
      const worldY = (mouseY - this.panY) / oldFullScale;

      // Update zoom
      const zoomSpeed = 0.001;
      const deltaZoom = -e.deltaY * zoomSpeed;
      this.setZoom(this.zoom + deltaZoom);

      // Calculate new full scale
      const newFullScale = (this.canvas.width / cachedMap.resolution) * this.viewScale;

      // Adjust pan so world position stays under mouse
      this.panX = mouseX - worldX * newFullScale;
      this.panY = mouseY - worldY * newFullScale;

      this.onRedraw();
    });

    // Touch events
    this.canvas.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        // Single finger pan
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
        // Two finger pinch
        e.preventDefault();
        this.stopMomentum();
        this.isTouchPanning = false;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        this.initialPinchDistance = this.getTouchDistance(touch1, touch2);
        this.initialPinchZoom = this.zoom;

        // Calculate pinch center in canvas internal pixels
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        this.pinchCenterX =
          ((touch1.clientX + touch2.clientX) / 2 - rect.left) * scaleX;
        this.pinchCenterY =
          ((touch1.clientY + touch2.clientY) / 2 - rect.top) * scaleY;
      }
    });

    this.canvas.addEventListener("touchmove", (e: TouchEvent) => {
      if (e.touches.length === 1 && this.isTouchPanning) {
        // Single finger pan
        e.preventDefault();

        const touch = e.touches[0];
        const dx = touch.clientX - this.touchStartX;
        const dy = touch.clientY - this.touchStartY;

        // Convert display pixels to canvas internal pixels
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        this.panX = this.touchPanStartX + dx * scaleX;
        this.panY = this.touchPanStartY + dy * scaleY;

        // Track velocity for momentum
        const now = Date.now();
        const dt = now - this.lastMoveTime;
        if (dt > 0) {
          const moveX = (touch.clientX - this.lastMoveX) * scaleX;
          const moveY = (touch.clientY - this.lastMoveY) * scaleY;
          this.velocityX = (moveX / dt) * 16;
          this.velocityY = (moveY / dt) * 16;
        }
        this.lastMoveTime = now;
        this.lastMoveX = touch.clientX;
        this.lastMoveY = touch.clientY;

        this.onRedraw();
      } else if (
        e.touches.length === 2 &&
        this.initialPinchDistance !== null &&
        this.initialPinchZoom !== null
      ) {
        // Two finger pinch
        e.preventDefault();

        const cachedMap = this.getCachedMap();
        if (!cachedMap) return;

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = this.getTouchDistance(touch1, touch2);

        // Calculate full scale factor
        const oldFullScale = (this.canvas.width / cachedMap.resolution) * this.viewScale;

        // Calculate world position under pinch center before zoom
        const worldX = (this.pinchCenterX - this.panX) / oldFullScale;
        const worldY = (this.pinchCenterY - this.panY) / oldFullScale;

        // Calculate zoom factor
        const distanceRatio = currentDistance / this.initialPinchDistance;
        const zoomDelta = (distanceRatio - 1) * 0.5;
        this.setZoom(this.initialPinchZoom + zoomDelta);

        // Calculate new full scale
        const newFullScale = (this.canvas.width / cachedMap.resolution) * this.viewScale;

        // Adjust pan so world position stays under pinch center
        this.panX = this.pinchCenterX - worldX * newFullScale;
        this.panY = this.pinchCenterY - worldY * newFullScale;

        this.onRedraw();
      }
    });

    this.canvas.addEventListener("touchend", (e: TouchEvent) => {
      if (e.touches.length === 0) {
        // All touches ended
        if (this.isTouchPanning) {
          this.isTouchPanning = false;

          const speedThreshold = lerp(5, 0.5, this.momentum);
          const speed = Math.sqrt(
            this.velocityX * this.velocityX + this.velocityY * this.velocityY
          );
          if (speed > speedThreshold) {
            this.startMomentum();
          }
        }
        this.initialPinchDistance = null;
        this.initialPinchZoom = null;
      } else if (e.touches.length < 2) {
        // Went from 2+ touches to 1 touch
        this.initialPinchDistance = null;
        this.initialPinchZoom = null;
      }
    });
  }
}
