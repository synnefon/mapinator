import type { Vec3 } from "../../common/3DMath";

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function clampSigned(n: number): number {
  return clamp(n, -1, 1);
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

export function inverseLerpNumber(a: number, b: number, value: number): number {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
}

export function remapNumber(
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  value: number,
): number {
  return lerpNumber(outMin, outMax, inverseLerpNumber(inMin, inMax, value));
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function gaussian(x: number, center: number, width: number): number {
  if (width <= 0) return x === center ? 1 : 0;

  const z = (x - center) / width;
  return Math.exp(-0.5 * z * z);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;

  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;

  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function saturate(n: number): number {
  return clamp01(n);
}

export function safeDivide(numerator: number, denominator: number, fallback = 0): number {
  return Math.abs(denominator) < 1e-12 ? fallback : numerator / denominator;
}

// -------------------------------------------------------------------------------------
// Sphere helpers
// -------------------------------------------------------------------------------------

export function sphereLatitudeDeg(position: Vec3): number {
  return radToDeg(Math.asin(clamp(normalizeVec3(position).y, -1, 1)));
}

export function sphereLongitudeDeg(position: Vec3): number {
  const p = normalizeVec3(position);
  return radToDeg(Math.atan2(p.z, p.x));
}

/**
 * Tangent direction of increasing longitude.
 */
export function localEast(position: Vec3): Vec3 {
  const p = normalizeVec3(position);

  const east = {
    x: -p.z,
    y: 0,
    z: p.x,
  };

  const mag = lengthVec3(east);

  // Longitude is undefined at the poles.
  if (mag < 1e-8) {
    return { x: 1, y: 0, z: 0 };
  }

  return scaleVec3(east, 1 / mag);
}

/**
 * Tangent direction of increasing latitude.
 */
export function localNorth(position: Vec3): Vec3 {
  const p = normalizeVec3(position);

  const globalNorth = {
    x: 0,
    y: 1,
    z: 0,
  };

  const projected = subtractVec3(
    globalNorth,
    scaleVec3(p, dotVec3(globalNorth, p)),
  );

  const mag = lengthVec3(projected);

  // Latitude is undefined at the poles.
  if (mag < 1e-8) {
    return {
      x: 0,
      y: 0,
      z: -Math.sign(p.y || 1),
    };
  }

  return scaleVec3(projected, 1 / mag);
}

// -------------------------------------------------------------------------------------
// Vector arithmetic
// -------------------------------------------------------------------------------------

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
}

export function subtractVec3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

export function scaleVec3(v: Vec3, s: number): Vec3 {
  return {
    x: v.x * s,
    y: v.y * s,
    z: v.z * s,
  };
}

export function dotVec3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lengthVec3(v: Vec3): number {
  return Math.sqrt(dotVec3(v, v));
}

export function normalizeVec3(v: Vec3): Vec3 {
  const len = lengthVec3(v);

  if (len < 1e-8) {
    return {
      x: 1,
      y: 0,
      z: 0,
    };
  }

  return {
    x: v.x / len,
    y: v.y / len,
    z: v.z / len,
  };
}
