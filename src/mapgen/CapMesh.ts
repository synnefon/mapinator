import Delaunator from "delaunator";
import type { MeshCell, Vec3 } from "../common/map";

/**
 * Spherical Voronoi mesh of `sites` inside a cap around `center`, via stereographic
 * projection + planar Delaunay (delaunator). Stereographic maps circles → circles,
 * so the planar Delaunay equals the geodesic Delaunay exactly; the Voronoi vertices
 * are then the spherical circumcenters, computed in 3D and therefore independent of
 * the projection — so overlapping patches share cell shapes (stable on pan), just
 * like the spherical geoVoronoi it replaces, but far faster (no GeoJSON, no lon/lat
 * round-trips, no unused graph structure).
 *
 * Cells with center·site < `keepCos`, and unbounded hull cells, are dropped (the rim
 * padding, which is off-screen). Those drops are why projecting only the cap — rather
 * than the whole sphere — is correct: every KEPT cell is interior, so all of its
 * geodesic neighbors are present and its Voronoi polygon is fully determined.
 */
export function capDelaunayMesh(
  sites: Vec3[],
  center: Vec3,
  keepCos: number
): MeshCell[] {
  const n = sites.length;
  if (n < 3) return [];

  // Orthonormal basis with `center` as the pole; stereographic-project from the
  // antipode (center·s ≥ cosCap > 0, so 1 + Z never vanishes). Used only to get the
  // triangulation topology — all geometry below is rebuilt in 3D.
  const w = center;
  const seed = Math.abs(w.x) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ux = w.y * seed.z - w.z * seed.y;
  let uy = w.z * seed.x - w.x * seed.z;
  let uz = w.x * seed.y - w.y * seed.x;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = w.y * uz - w.z * uy;
  const vy = w.z * ux - w.x * uz;
  const vz = w.x * uy - w.y * ux;

  const coords = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    const s = sites[i];
    const X = s.x * ux + s.y * uy + s.z * uz;
    const Y = s.x * vx + s.y * vy + s.z * vz;
    const Z = s.x * w.x + s.y * w.y + s.z * w.z;
    const k = 1 / (1 + Z);
    coords[2 * i] = X * k;
    coords[2 * i + 1] = Y * k;
  }

  const delaunay = new Delaunator(coords);
  const { triangles, halfedges } = delaunay;
  const numTri = triangles.length / 3;

  // Spherical circumcenter of each triangle: the sphere point equidistant from its
  // three sites = the unit normal of their plane, flipped onto the sites' hemisphere.
  const cc: Vec3[] = new Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const a = sites[triangles[3 * t]];
    const b = sites[triangles[3 * t + 1]];
    const c = sites[triangles[3 * t + 2]];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    if (nx * a.x + ny * a.y + nz * a.z < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    cc[t] = { x: nx, y: ny, z: nz };
  }

  // One incoming halfedge per site, preferring hull edges so hull cells start there
  // and are detected as unbounded during the walk below.
  const inedges = new Int32Array(n).fill(-1);
  for (let e = 0; e < halfedges.length; e++) {
    const endpoint = triangles[e % 3 === 2 ? e - 2 : e + 1];
    if (halfedges[e] === -1 || inedges[endpoint] === -1) inedges[endpoint] = e;
  }

  const mesh: MeshCell[] = [];
  for (let i = 0; i < n; i++) {
    const site = sites[i];
    if (site.x * center.x + site.y * center.y + site.z * center.z < keepCos) {
      continue; // rim padding → off-screen, drop
    }
    const e0 = inedges[i];
    if (e0 === -1) continue;

    // Rotate around the site through its incident triangles, collecting their
    // circumcenters; a -1 link means a hull edge → unbounded cell, drop it.
    const ring: Vec3[] = [];
    let e = e0;
    let unbounded = false;
    do {
      ring.push(cc[(e / 3) | 0]);
      const next = e % 3 === 2 ? e - 2 : e + 1;
      e = halfedges[next];
      if (e === -1) {
        unbounded = true;
        break;
      }
    } while (e !== e0);

    if (unbounded || ring.length < 3) continue;
    mesh.push({ site, ring });
  }

  return mesh;
}
