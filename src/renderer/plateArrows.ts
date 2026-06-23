import { Quat } from "../common/3DMath";
import { globeRadiusPx } from "./GlobeRenderer";

// The arrows are a "view plates" annotation drawn on a 2D overlay canvas layered over the globe
// (the WebGL map canvas can't share a 2D context). The arrow GEOMETRY — tail positions + tangent
// directions along plate boundaries — is sampled in the worker (see Tectonics.boundaryArrows), so
// it matches the warped boundaries the overlay colours; here we only project + draw it.
const SHAFT_PX = 22; // on-screen arrow length, FIXED px — so arrows never balloon as you zoom in
const HEAD_FRAC = 0.42; // arrowhead length ÷ shaft length
const HEAD_HALF = 0.5; // half-angle (rad) of the arrowhead barbs off the shaft
const MIN_FRONT_Z = 0.04; // cull arrows whose tail sits at/behind the visible limb
const DIR_EPSILON = 0.1; // skip arrows whose motion points ~straight at/away from camera (no 2D dir)
const HEAD_LEN = SHAFT_PX * HEAD_FRAC;
// Drawn twice for contrast over any terrain: a dark casing, then a light core on top.
const CASING = { style: "rgba(20,20,20,0.85)", width: 3.4 };
const CORE = { style: "rgba(255,255,255,0.95)", width: 1.5 };

/**
 * Draw the plate-motion arrows onto a 2D overlay canvas, projected to match the globe exactly:
 * orthographic, same apparent radius (globeRadiusPx) and horizontal offset as the active renderer.
 * `positions` / `directions` are flat [x,y,z,…] arrays (unit-sphere tail + unit tangent), one entry
 * per arrow. The head is anchored at the boundary probe and the fixed-length shaft trails back into
 * the owning plate, so arrows point across the boundary without overhanging past it. Clears first,
 * so an empty list just wipes the overlay (the plate view being off).
 */
export function drawPlateArrows(
  canvas: HTMLCanvasElement,
  positions: Float32Array,
  directions: Float32Array,
  orientation: Quat,
  zoom: number,
  offsetFraction: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: W, height: H } = canvas;
  ctx.clearRect(0, 0, W, H);
  if (positions.length === 0) return;

  const radius = globeRadiusPx(canvas, zoom);
  const offX = offsetFraction * W;
  const cx = W / 2;
  const cy = H / 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < positions.length; i += 3) {
    const tail = Quat.rotate(orientation, {
      x: positions[i],
      y: positions[i + 1],
      z: positions[i + 2],
    });
    if (tail.z < MIN_FRONT_Z) continue; // back hemisphere / right at the limb

    // Project the tangent to screen space; skip arrows pointing nearly at/away from the camera
    // (their 2D direction is ill-defined there).
    const rd = Quat.rotate(orientation, {
      x: directions[i],
      y: directions[i + 1],
      z: directions[i + 2],
    });
    let sdx = rd.x;
    let sdy = -rd.y; // screen y is flipped
    const sl = Math.hypot(sdx, sdy);
    if (sl < DIR_EPSILON) continue;
    sdx /= sl;
    sdy /= sl;

    // Head at the boundary probe; shaft trails back into the owning plate (no overhang past it).
    const hx = cx + tail.x * radius + offX;
    const hy = cy - tail.y * radius;
    const tx = hx - sdx * SHAFT_PX;
    const ty = hy - sdy * SHAFT_PX;

    const back = Math.atan2(sdy, sdx) + Math.PI; // barbs splay off the reversed shaft
    const bx1 = hx + HEAD_LEN * Math.cos(back - HEAD_HALF);
    const by1 = hy + HEAD_LEN * Math.sin(back - HEAD_HALF);
    const bx2 = hx + HEAD_LEN * Math.cos(back + HEAD_HALF);
    const by2 = hy + HEAD_LEN * Math.sin(back + HEAD_HALF);

    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.moveTo(bx1, by1);
      ctx.lineTo(hx, hy);
      ctx.lineTo(bx2, by2);
    };
    for (const pass of [CASING, CORE]) {
      ctx.strokeStyle = pass.style;
      ctx.lineWidth = pass.width;
      trace();
      ctx.stroke();
    }
  }
}
