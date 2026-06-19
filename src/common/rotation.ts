import type { Vec3 } from "./map";

// Orientation as a unit quaternion (maps world → view space). Lets us do true
// direct manipulation: rotate so the point under the cursor stays under the cursor
// (arcball pan + zoom-to-cursor), which yaw/pitch increments can't express.
export type Quat = { x: number; y: number; z: number; w: number };

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** a ∘ b — applies b first, then a. */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function qNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** Rotate vector v by quaternion q. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Quaternion from a UNIT axis + angle (radians). */
export function qFromAxisAngle(
  x: number,
  y: number,
  z: number,
  angle: number
): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
}

/** Smallest rotation taking unit vector `from` to unit vector `to`. */
export function quatBetween(from: Vec3, to: Vec3): Quat {
  const d = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (d > 0.999999) return QUAT_IDENTITY;
  let ax = from.y * to.z - from.z * to.y;
  let ay = from.z * to.x - from.x * to.z;
  let az = from.x * to.y - from.y * to.x;
  let len = Math.hypot(ax, ay, az);
  if (len < 1e-9) {
    // antiparallel — spin 180° about any axis perpendicular to `from`
    ax = from.y;
    ay = -from.x;
    az = 0;
    len = Math.hypot(ax, ay, az) || 1;
  }
  return qFromAxisAngle(ax / len, ay / len, az / len, Math.acos(d));
}

/** World point currently facing the camera (the one that maps to view +Z). */
export function quatViewCenter(q: Quat): Vec3 {
  return qRotate(qConjugate(q), { x: 0, y: 0, z: 1 });
}
