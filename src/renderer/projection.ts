import { Quat, type Vec3 } from "../common/3DMath";
import { globeRadiusPx } from "./GlobeRenderer";

// The standard limb cull: a unit-sphere point is "front" (safely on the visible hemisphere, off the
// limb) when its view-space z is at least this. Every overlay — canvas AND DOM — shared this exact
// constant and the same project-and-cull block; it now lives ONLY here.
const MIN_FRONT_Z = 0.04;

export type ScreenPoint = {
  x: number; // canvas/viewport px
  y: number; // canvas/viewport px
  z: number; // view-space depth (> 0 = near hemisphere) — exposed for the rare custom cull (e.g. z > 0)
  front: boolean; // z >= MIN_FRONT_Z — the standard "safely in front of the limb" test
};

/**
 * The view → screen mapping the globe is drawn with, shared by every overlay so there is ONE place the
 * projection (and the limb cull) lives. Orthographic: rotate a unit-sphere point by the view orientation,
 * scale by the apparent globe radius, centre it, and nudge right by the active renderer's horizontal
 * offset. Built once per frame from the view; carries the scalars overlays size themselves against
 * (zoom, radius, refRadius) so none of them re-derive the projection or ask the renderer for its offset.
 *
 * Constructed from raw width/height (not a canvas), so it's pure and unit-tests with no DOM.
 */
export type Projector = {
  zoom: number; // orbit zoom (0 = whole globe, 1 = deepest) — for zoom-dependent label/river sizing
  radius: number; // apparent globe radius (px) at this zoom — for on-screen size (fonts, river widths)
  refRadius: number; // the zoom-0 radius — a fixed reference (e.g. rivers thicken with radius/refRadius)
  project(p: Vec3): ScreenPoint;
  projectDir(d: Vec3): { x: number; y: number }; // a unit tangent → screen-space direction (y-flipped, unnormalized)
};

export function makeProjector(
  width: number,
  height: number,
  orientation: Quat,
  zoom: number,
  offsetFraction: number
): Projector {
  const radius = globeRadiusPx({ width, height }, zoom);
  const refRadius = globeRadiusPx({ width, height }, 0);
  const offX = offsetFraction * width;
  const cx = width / 2;
  const cy = height / 2;
  return {
    zoom,
    radius,
    refRadius,
    project(p) {
      const r = Quat.rotate(orientation, p);
      return { x: cx + r.x * radius + offX, y: cy - r.y * radius, z: r.z, front: r.z >= MIN_FRONT_Z };
    },
    projectDir(d) {
      const r = Quat.rotate(orientation, d);
      return { x: r.x, y: -r.y }; // screen y is flipped; magnitude preserved for the caller's epsilon test
    },
  };
}
