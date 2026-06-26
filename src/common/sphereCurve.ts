import { Vec3 } from "./3DMath";

// === Fractal refinement of curves on the unit sphere ===
//
// Recursively insert perpendicular-displaced midpoints so a polyline gains self-similar wiggle: river
// meander, organic borders. Displacement is DETERMINISTIC in the midpoint's position, so it's stable
// across frames and identical wherever two curves share a point (no seams). Being fractal, the finest
// wiggle is sub-pixel when zoomed out and resolves as you zoom in — detail-on-demand with no regen.
// Per-vertex scalar data (e.g. a river's flow width) rides along by linear interpolation.
//
// Shared by the VECTOR OVERLAYS (rivers now; country borders next). NOTE coastlines are deliberately
// NOT a client: the coast IS the terrain's land/water boundary, not an overlay, so a refined coast
// polyline would disagree with the per-cell colouring — coast zoom-detail belongs in the patch shader
// (perturb the sea-level threshold with zoom-resolved noise), not here.

/** Deterministic pseudo-random in [-1, 1] from a point — a hash (cheap + stable), not noise. */
function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
}

/** One corner-cutting pass: between each pair of vertices insert a midpoint displaced sideways (in the
 *  sphere's tangent plane) by amplitude × segment-length × hash. Endpoints are preserved. */
function refineOnce(
  points: Vec3[],
  values: number[],
  amplitude: number
): { points: Vec3[]; values: number[] } {
  const outP: Vec3[] = [];
  const outV: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    outP.push(a);
    outV.push(values[i]);
    const seg = Vec3.sub(b, a);
    const chord = Math.hypot(seg.x, seg.y, seg.z);
    const mid = Vec3.normalize(Vec3.add(a, b));
    const perp = Vec3.normalize(Vec3.cross(mid, seg)); // tangent ⊥ the segment, on the surface
    const disp = amplitude * chord * hash(mid.x, mid.y, mid.z);
    outP.push(Vec3.normalize(Vec3.add(mid, Vec3.scale(perp, disp))));
    outV.push((values[i] + values[i + 1]) * 0.5);
  }
  outP.push(points[points.length - 1]);
  outV.push(values[values.length - 1]);
  return { points: outP, values: outV };
}

/** Fractally refine a sphere polyline `levels` times (≈ ×2^levels vertices). Amplitude scales with each
 *  segment's length, so the wiggle is self-similar across scales (1/f). A short curve (< 2 pts) is
 *  returned unchanged. */
export function refineSphereCurve(
  points: Vec3[],
  values: number[],
  opts: { levels: number; amplitude: number }
): { points: Vec3[]; values: number[] } {
  let p = points;
  let v = values;
  for (let l = 0; l < opts.levels && p.length >= 2; l++) {
    const r = refineOnce(p, v, opts.amplitude);
    p = r.points;
    v = r.values;
  }
  return { points: p, values: v };
}
