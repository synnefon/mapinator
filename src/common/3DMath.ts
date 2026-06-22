export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

// Shared Vec3 operators. Pure and allocation-light, for the spots where clarity wins.
// Hot inner loops (CapMesh circumcenters, the stereographic projection, the Quat
// formulas below) keep their math inline on destructured scalars on purpose —
// perf over DRY there.
export const Vec3 = {
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,

  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),

  add: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  }),

  sub: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  }),

  scale: (a: Vec3, k: number): Vec3 => ({
    x: a.x * k,
    y: a.y * k,
    z: a.z * k,
  }),

  normalize: (v: Vec3): Vec3 => {
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  },
};

// Orientation as a unit quaternion (maps world → view space). Lets us do true
// direct manipulation: rotate so the point under the cursor stays under the cursor
// (arcball pan + zoom-to-cursor), which yaw/pitch increments can't express.
export type Quat = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export const Quat = {
  identity: { x: 0, y: 0, z: 0, w: 1 } as Quat,

  /** a ∘ b — applies b first, then a. */
  mul: (a: Quat, b: Quat): Quat => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }),

  conjugate: (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w }),

  normalize: (q: Quat): Quat => {
    const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
  },

  /** Rotate vector v by quaternion q. */
  rotate: (q: Quat, v: Vec3): Vec3 => {
    const tx = 2 * (q.y * v.z - q.z * v.y);
    const ty = 2 * (q.z * v.x - q.x * v.z);
    const tz = 2 * (q.x * v.y - q.y * v.x);
    return {
      x: v.x + q.w * tx + (q.y * tz - q.z * ty),
      y: v.y + q.w * ty + (q.z * tx - q.x * tz),
      z: v.z + q.w * tz + (q.x * ty - q.y * tx),
    };
  },

  /** Quaternion from a UNIT axis + angle (radians). */
  fromAxisAngle: (x: number, y: number, z: number, angle: number): Quat => {
    const h = angle / 2;
    const s = Math.sin(h);
    return { x: x * s, y: y * s, z: z * s, w: Math.cos(h) };
  },

  /** Smallest rotation taking unit vector `from` to unit vector `to`. */
  between: (from: Vec3, to: Vec3): Quat => {
    const d = from.x * to.x + from.y * to.y + from.z * to.z;
    // Robust "quaternion between vectors": vector part = from × to (= axis·sin θ),
    // w = 1 + cos θ, then normalize. No acos and no near-identity early-out, so tiny
    // rotations stay exact — at high zoom each drag step is a sub-degree rotation, and
    // an acos/threshold path rounds those to identity (the drag would stall).
    let x = from.y * to.z - from.z * to.y;
    let y = from.z * to.x - from.x * to.z;
    let z = from.x * to.y - from.y * to.x;
    let w = 1 + d;
    if (w < 1e-9) {
      // (Near-)antiparallel: 180° about any axis perpendicular to `from`.
      if (Math.abs(from.x) > Math.abs(from.z)) {
        x = -from.y;
        y = from.x;
        z = 0;
      } else {
        x = 0;
        y = -from.z;
        z = from.y;
      }
      w = 0;
    }
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  },

  /** World point currently facing the camera (the one that maps to view +Z). */
  viewCenter: (q: Quat): Vec3 =>
    Quat.rotate(Quat.conjugate(q), { x: 0, y: 0, z: 1 }),

  /** Spherical interpolation a → b (t in [0,1]), along the shorter arc. */
  slerp: (a: Quat, b: Quat, t: number): Quat => {
    let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x;
    let by = b.y;
    let bz = b.z;
    let bw = b.w;
    if (dot < 0) {
      // Flip one end so we interpolate the short way around (q and -q are the same rotation).
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      dot = -dot;
    }
    if (dot > 0.9995) {
      // Nearly aligned: lerp + normalize avoids the sin(θ)→0 blowup below.
      return Quat.normalize({
        x: a.x + (bx - a.x) * t,
        y: a.y + (by - a.y) * t,
        z: a.z + (bz - a.z) * t,
        w: a.w + (bw - a.w) * t,
      });
    }
    const theta0 = Math.acos(dot);
    const sinTheta0 = Math.sin(theta0);
    const s0 = Math.sin(theta0 * (1 - t)) / sinTheta0;
    const s1 = Math.sin(theta0 * t) / sinTheta0;
    return {
      x: s0 * a.x + s1 * bx,
      y: s0 * a.y + s1 * by,
      z: s0 * a.z + s1 * bz,
      w: s0 * a.w + s1 * bw,
    };
  },
};
