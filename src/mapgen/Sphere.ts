import type { Vec3 } from "../common/vec3";
import { clamp } from "../common/util";

// Golden angle drives the Fibonacci spiral; the constants convert between the
// sphere's 3D unit vectors and the [lon, lat] degrees that d3-geo / geoVoronoi want.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Evenly-spaced points on the unit sphere (Fibonacci spiral). Deterministic. */
export function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = new Array(n);
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / denom) * 2; // +1 (north pole) → -1 (south pole)
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    pts[i] = { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
  }
  return pts;
}

/** Unit vector → [lon, lat] degrees (latitude along +Y), for geoVoronoi input. */
export function vec3ToLonLat(v: Vec3): [number, number] {
  const lat = Math.asin(clamp(v.y, -1, 1)) * RAD2DEG;
  const lon = Math.atan2(v.z, v.x) * RAD2DEG;
  return [lon, lat];
}

/** [lon, lat] degrees → unit vector (inverse of vec3ToLonLat). */
export function lonLatToVec3(lon: number, lat: number): Vec3 {
  const la = lat * DEG2RAD;
  const lo = lon * DEG2RAD;
  const cosLat = Math.cos(la);
  return { x: cosLat * Math.cos(lo), y: Math.sin(la), z: cosLat * Math.sin(lo) };
}

/**
 * The points of the size-`n` Fibonacci sphere that fall inside the spherical cap
 * around `center` with the given `halfAngle`. The full set's layout depends only on
 * `n`, so meshing the subset in a view's cap gives STABLE cell shapes as you pan
 * (overlapping views share the same points) rather than a fresh tessellation.
 *
 * Fibonacci y decreases monotonically with index, so the cap's y-band is a
 * contiguous index slice: we scan only that slice and compute each position on the
 * fly — no full-set array (millions of points → tens of MB) and no scan of all `n`.
 */
export function fibonacciCapSites(
  center: Vec3,
  halfAngle: number,
  n: number
): Vec3[] {
  const denom = Math.max(1, n - 1);
  const cosCap = Math.cos(halfAngle);
  const { x: cx, y: cy, z: cz } = center;

  // A cap constrains p.y to [yMin, yMax] (extrema of the linear functional p·ŷ over
  // the cap, whose axis makes angle phi with ŷ). Map that band to indices via
  // y = 1 - 2i/denom (decreasing in i), widening by floor/ceil so no edge point is
  // missed; the cosCap test below drops the band's out-of-cap longitudes.
  const phi = Math.acos(clamp(cy, -1, 1));
  const yMax = Math.cos(Math.max(0, phi - halfAngle));
  const yMin = Math.cos(Math.min(Math.PI, phi + halfAngle));
  const iAtY = (y: number) => ((1 - y) * denom) / 2;
  const iMin = Math.max(0, Math.floor(iAtY(yMax)));
  const iMax = Math.min(n - 1, Math.ceil(iAtY(yMin)));

  const sites: Vec3[] = [];
  for (let i = iMin; i <= iMax; i++) {
    const y = 1 - (i / denom) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * GOLDEN_ANGLE;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (x * cx + y * cy + z * cz >= cosCap) sites.push({ x, y, z });
  }
  return sites;
}
