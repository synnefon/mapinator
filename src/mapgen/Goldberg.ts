import { Vec3 } from "../common/3DMath";
import type { MeshCell } from "../common/map";

/**
 * Goldberg polyhedron mesh: a (mostly) hexagonal tiling of the sphere, built as the
 * DUAL of a geodesic icosahedron. Subdividing the icosahedron and taking the dual
 * gives hexagons everywhere except 12 pentagons at the original icosahedron vertices
 * — the unavoidable defects when you tile a sphere with hexagons (Euler's formula).
 *
 * Crucially the grid is DETERMINISTIC and NESTED: level L's vertices are a subset of
 * level L+1's, so a finer grid refines the coarse cells in place rather than
 * re-tessellating from scratch. That's what makes the hexes stable under zoom — the
 * thing the old Fibonacci-Voronoi mesh couldn't do.
 */

// Regular icosahedron (12 verts, 20 faces): the seed for geodesic subdivision.
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: Vec3[] = [
  { x: -1, y: PHI, z: 0 }, { x: 1, y: PHI, z: 0 },
  { x: -1, y: -PHI, z: 0 }, { x: 1, y: -PHI, z: 0 },
  { x: 0, y: -1, z: PHI }, { x: 0, y: 1, z: PHI },
  { x: 0, y: -1, z: -PHI }, { x: 0, y: 1, z: -PHI },
  { x: PHI, y: 0, z: -1 }, { x: PHI, y: 0, z: 1 },
  { x: -PHI, y: 0, z: -1 }, { x: -PHI, y: 0, z: 1 },
].map(Vec3.normalize);

const ICO_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Subdivision level whose cell count (10·4^L + 2) is nearest to `points`, clamped to
 *  [lo, hi]. */
function goldbergLevel(points: number, lo: number, hi: number): number {
  const level = Math.round(Math.log(Math.max(1, (points - 2) / 10)) / Math.log(4));
  return Math.max(lo, Math.min(hi, level));
}

/** Global (whole-globe) level from the resolution slider's point count. Kept coarse enough
 *  that the hexes read clearly at the zoomed-out view. */
export function goldbergLevelForPoints(points: number): number {
  return goldbergLevel(points, 3, 6);
}

/** Cap (zoomed-in) level from a patch rung's point count. Always FINER than the global so a
 *  cap adds detail — and since every level is a subdivision of the same icosahedron, the cap
 *  hexes nest inside the global ones (they refine in place → stable, no shift on zoom). */
export function goldbergCapLevel(points: number): number {
  return goldbergLevel(points, 7, 11);
}

/** Whole-globe GPU-OVERLAY level from a point count. Finer than the coarse CPU base
 *  (goldbergLevelForPoints, ≤ 6) so the zoomed-OUT coastline matches the detail patches, but capped
 *  at 8 (≈ 655K cells) because this meshes the WHOLE sphere — beyond that the one-time build gets
 *  expensive and the extra cells are sub-pixel at the zoomed-out view anyway. */
export function goldbergGlobeOverlayLevel(points: number): number {
  return goldbergLevel(points, 7, 8);
}

/** Geodesic icosphere at `level`: every triangle bisected `level` times, all vertices
 *  on the unit sphere. Shared edge midpoints are cached so vertices aren't duplicated. */
function buildGeodesic(level: number): {
  vertices: Vec3[];
  faces: [number, number, number][];
} {
  const vertices: Vec3[] = ICO_VERTS.map((v) => ({ ...v }));
  let faces: [number, number, number][] = ICO_FACES.map(
    (f) => [...f] as [number, number, number]
  );
  const midCache = new Map<string, number>(); // "lo_hi" edge → midpoint vertex index
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = midCache.get(key);
    if (hit !== undefined) return hit;
    const va = vertices[a];
    const vb = vertices[b];
    const idx = vertices.length;
    vertices.push(Vec3.normalize({ x: va.x + vb.x, y: va.y + vb.y, z: va.z + vb.z }));
    midCache.set(key, idx);
    return idx;
  };
  for (let l = 0; l < level; l++) {
    const next: [number, number, number][] = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { vertices, faces };
}

/** Order a vertex's incident face centroids CCW around it, forming the dual cell ring. */
function orderRing(site: Vec3, faceIdx: number[], centroids: Vec3[]): Vec3[] {
  // Tangent basis at the site (u, w both ⊥ site): angle in this plane sorts the ring.
  const ref = Math.abs(site.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = Vec3.normalize(Vec3.cross(site, ref));
  const w = Vec3.cross(site, u);
  return faceIdx
    .map((f) => ({
      p: centroids[f],
      ang: Math.atan2(Vec3.dot(centroids[f], w), Vec3.dot(centroids[f], u)),
    }))
    .sort((a, b) => a.ang - b.ang)
    .map((o) => o.p);
}

/**
 * Hexagonal (Goldberg) mesh at the given subdivision `level`, as MeshCell[] in the same
 * {site, ring} shape the Voronoi mesher produced — so it drops straight into packMesh
 * and the renderer. Each cell's `site` is a geodesic vertex (where the field is sampled)
 * and its `ring` is the surrounding face centroids (the hexagon/pentagon corners).
 */
export function goldbergMesh(level: number): MeshCell[] {
  const { vertices, faces } = buildGeodesic(level);

  const incident: number[][] = vertices.map(() => []);
  const centroids: Vec3[] = new Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    incident[a].push(f);
    incident[b].push(f);
    incident[c].push(f);
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    centroids[f] = Vec3.normalize({
      x: va.x + vb.x + vc.x,
      y: va.y + vb.y + vc.y,
      z: va.z + vb.z + vc.z,
    });
  }

  const cells: MeshCell[] = new Array(vertices.length);
  for (let v = 0; v < vertices.length; v++) {
    cells[v] = { site: vertices[v], ring: orderRing(vertices[v], incident[v], centroids) };
  }
  return cells;
}

/**
 * Hex mesh of just the spherical cap around `center` (angular radius `halfAngle`), at a
 * FINER subdivision `level` than the global mesh. Only the icosahedron faces overlapping
 * the cap are subdivided (the rest stay coarse and are dropped), so the cost scales with
 * the cap, not the whole sphere. Because it's the same icosahedron subdivided further, the
 * cap hexes nest inside the global ones — refining detail in place, never re-tessellating.
 *
 * Used as the zoom overlay: the global mesh shows through at the rim (where boundary cells
 * are dropped), and the cap covers the view.
 */
export function goldbergCapMesh(
  center: Vec3,
  halfAngle: number,
  level: number
): MeshCell[] {
  const angle = (u: Vec3, v: Vec3): number =>
    Math.acos(Math.min(1, Math.max(-1, Vec3.dot(u, v))));
  // Subdivide a face only if it can reach the cap (+ margin so kept rim cells have complete
  // rings). The face's own angular radius is added so a big COARSE face straddling the cap
  // is still caught even when its vertices are far from the centre.
  const limit = Math.min(Math.PI, halfAngle * 1.3 + 0.05);

  const vertices: Vec3[] = ICO_VERTS.map((v) => ({ ...v }));
  // 4th tuple slot = subdivision depth, so we can tell fully-fine cells (depth === level →
  // complete ring) from coarse boundary cells (dropped).
  let faces: [number, number, number, number][] = ICO_FACES.map((f) => [
    f[0],
    f[1],
    f[2],
    0,
  ]);
  const midCache = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const hit = midCache.get(key);
    if (hit !== undefined) return hit;
    const va = vertices[a];
    const vb = vertices[b];
    const idx = vertices.length;
    vertices.push(Vec3.normalize({ x: va.x + vb.x, y: va.y + vb.y, z: va.z + vb.z }));
    midCache.set(key, idx);
    return idx;
  };
  const overlapsCap = (a: number, b: number, c: number): boolean => {
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    const cen = Vec3.normalize({
      x: va.x + vb.x + vc.x,
      y: va.y + vb.y + vc.y,
      z: va.z + vb.z + vc.z,
    });
    const triR = Math.max(angle(cen, va), angle(cen, vb), angle(cen, vc));
    return angle(center, cen) <= limit + triR;
  };
  for (let l = 0; l < level; l++) {
    const next: [number, number, number, number][] = [];
    for (const [a, b, c, d] of faces) {
      if (!overlapsCap(a, b, c)) {
        next.push([a, b, c, d]); // far from the cap → leave coarse, its cells get dropped
        continue;
      }
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(
        [a, ab, ca, d + 1],
        [b, bc, ab, d + 1],
        [c, ca, bc, d + 1],
        [ab, bc, ca, d + 1]
      );
    }
    faces = next;
  }

  // Dual over fully-fine vertices inside the cap. A vertex touching any coarser face is on
  // the cap boundary (incomplete ring) → drop it; it sits in the off-screen margin anyway.
  const incident: number[][] = vertices.map(() => []);
  const touchesCoarse: boolean[] = new Array(vertices.length).fill(false);
  const centroids: Vec3[] = new Array(faces.length);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c, d] = faces[f];
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    centroids[f] = Vec3.normalize({
      x: va.x + vb.x + vc.x,
      y: va.y + vb.y + vc.y,
      z: va.z + vb.z + vc.z,
    });
    if (d === level) {
      incident[a].push(f);
      incident[b].push(f);
      incident[c].push(f);
    } else {
      touchesCoarse[a] = true;
      touchesCoarse[b] = true;
      touchesCoarse[c] = true;
    }
  }

  const keepCos = Math.cos(halfAngle);
  const cells: MeshCell[] = [];
  for (let v = 0; v < vertices.length; v++) {
    if (touchesCoarse[v] || Vec3.dot(vertices[v], center) < keepCos) continue;
    const ring = orderRing(vertices[v], incident[v], centroids);
    if (ring.length >= 3) cells.push({ site: vertices[v], ring });
  }
  return cells;
}
