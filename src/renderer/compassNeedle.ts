import * as Zdog from "zdog";
import type { Vec3 } from "../common/vec3";
import { clamp } from "../common/util";
import { add, cross, dot, normalize, scale, sub } from "../common/vec3";

// A real 3D compass needle: the north-arrow chevron (from assets/north.svg) extruded into a
// thin solid slab, drawn with Zdog. Built once; `update(nv)` aims the tip along north's
// view-space direction each frame, `recolor()` repaints it in a theme colour. Being a solid,
// it keeps some thickness edge-on instead of vanishing like a flat icon.

// The arrowhead outline in model units (centred; Zdog y points down, matching the SVG): a
// north tip, two swept-back wings, and the notch between them. ~20 units tall.
const OUTLINE_UNITS: { x: number; y: number }[] = [
  { x: 0, y: -10.5 }, // north tip
  { x: 8.5, y: 9.5 }, // right wing
  { x: 0, y: 4.8 }, // back notch
  { x: -8.5, y: 9.5 }, // left wing
];
const OUTLINE_HEIGHT = 20; // tip-to-wing span of OUTLINE_UNITS
const FILL_FRACTION = 0.4; // arrowhead height ÷ canvas — sized to ~half the old needle
const DEPTH_RATIO = 0.3; // slab thickness ÷ arrowhead height — the depth that survives edge-on

// Fixed light direction (upper-front-left; Zdog y points down, so up = -y) for static flat
// shading. Zdog has no lighting model, so each face is pre-shaded by its normal.
const LIGHT = normalize({ x: -0.4, y: -0.7, z: 0.6 });

type Face = { shape: Zdog.Shape; light: number }; // light = shade factor in [-1, 1]

export type CompassNeedle = {
  update: (nv: Vec3) => void;
  recolor: (cssVar?: string) => void;
};

export function createCompassNeedle(canvas: HTMLCanvasElement): CompassNeedle {
  const illo = new Zdog.Illustration({ element: canvas, zoom: 1 });

  // Size the arrowhead to a fraction of the canvas, so it stays consistent regardless of the
  // canvas's pixel buffer.
  const dim = Math.min(canvas.width, canvas.height) || 60;
  const size = (dim * FILL_FRACTION) / OUTLINE_HEIGHT;
  const hd = (OUTLINE_HEIGHT * size * DEPTH_RATIO) / 2; // half the slab depth
  const stroke = Math.max(0.8, size * 0.5);

  // Front/back copies of the outline, offset along z → the two flat faces of the slab.
  const front: Vec3[] = OUTLINE_UNITS.map((p) => ({ x: p.x * size, y: p.y * size, z: hd }));
  const back: Vec3[] = OUTLINE_UNITS.map((p) => ({ x: p.x * size, y: p.y * size, z: -hd }));

  // Two caps + one side wall per outline edge make a closed, solid slab. Opaque fills that
  // Zdog z-sorts read as a single silhouette (no hollow double-outline).
  const paths: Vec3[][] = [front, [...back].reverse()];
  for (let i = 0; i < OUTLINE_UNITS.length; i++) {
    const j = (i + 1) % OUTLINE_UNITS.length;
    paths.push([front[i], front[j], back[j], back[i]]);
  }

  const faces: Face[] = paths.map((path) => ({
    shape: new Zdog.Shape({
      addTo: illo,
      path,
      closed: true,
      fill: true,
      stroke, // seals seams; Zdog uses one colour for stroke + fill, so no second outline
      backface: true,
    }),
    light: faceLight(path, LIGHT),
  }));

  const recolor = (cssVar = "--text") => {
    const base = resolveColor(
      getComputedStyle(document.documentElement).getPropertyValue(cssVar)
    );
    for (const f of faces) f.shape.color = shade(base, f.light);
    illo.updateRenderGraph();
  };

  const update = (nv: Vec3) => {
    // Aim the local tip (0,-1,0) along north's view direction, mapped to Zdog coords (flip y
    // since screen-up is -y). Roll is invisible for pointing, so a two-angle aim — rotate
    // about Z then X (Zdog applies Z before X) — hits the target direction exactly.
    illo.rotate.z = Math.asin(clamp(nv.x, -1, 1));
    illo.rotate.x = Math.atan2(-nv.z, nv.y);
    illo.rotate.y = 0;
    illo.updateRenderGraph();
  };

  recolor();
  return { update, recolor };
}

type RGB = [number, number, number];

/** Static flat-shade factor for a face: its outward normal dotted with the light. */
function faceLight(path: Vec3[], light: Vec3): number {
  const [a, b, c] = path;
  let n = normalize(cross(sub(b, a), sub(c, a)));
  const centroid = scale(add(add(a, b), c), 1 / 3); // points outward from the centre
  if (dot(n, centroid) < 0) n = scale(n, -1);
  return clamp(dot(n, light), -1, 1);
}

/** Lighten (toward white) or darken (toward black) a base colour by a [-1,1] factor. */
function shade(base: RGB, light: number): string {
  const target = light >= 0 ? 255 : 0;
  const amt = light >= 0 ? light * 0.4 : -light * 0.5;
  const mix = (c: number) => Math.round(c + (target - c) * amt);
  return `rgb(${mix(base[0])}, ${mix(base[1])}, ${mix(base[2])})`;
}

/** Resolve any CSS colour string (hex, rgb, theme value) to [r, g, b]. */
function resolveColor(input: string): RGB {
  const el = document.createElement("span");
  el.style.color = input.trim() || "#000";
  el.style.display = "none";
  document.body.appendChild(el);
  const rgb = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = rgb.match(/[\d.]+/g);
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [0, 0, 0];
}
