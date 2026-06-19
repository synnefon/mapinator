import type { Vec3 } from "../common/map";
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
