// 3D kd-tree over cell sites, for nearest-cell-to-a-direction lookups. Built once per map; shared by
// the choropleth texture bake (countryTexture.ts) and the LOD patch country re-grow (countries.ts),
// both of which map a fine sphere point to the nearest BASE cell. O(n log n) build, ~O(log n) query.

export type KdNode = { cell: number; axis: number; left: KdNode | null; right: KdNode | null };

export function buildKdTree(sites: Float32Array, n: number): KdNode | null {
  const idx = Array.from({ length: n }, (_v, i) => i);
  const build = (lo: number, hi: number, axis: number): KdNode | null => {
    if (lo >= hi) return null;
    const mid = (lo + hi) >> 1;
    // Median-split: sort this slice by the axis coordinate, take the middle as the node (build-once).
    const slice = idx.slice(lo, hi).sort((a, b) => sites[3 * a + axis] - sites[3 * b + axis]);
    for (let i = lo; i < hi; i++) idx[i] = slice[i - lo];
    return {
      cell: idx[mid],
      axis,
      left: build(lo, mid, (axis + 1) % 3),
      right: build(mid + 1, hi, (axis + 1) % 3),
    };
  };
  return build(0, n, 0);
}

/** Nearest cell to direction (x,y,z), by squared Euclidean distance (monotonic in angle on the sphere). */
export function nearestCell(root: KdNode | null, sites: Float32Array, x: number, y: number, z: number): number {
  let best = -1;
  let bestD2 = Infinity;
  const visit = (node: KdNode | null): void => {
    if (!node) return;
    const c = node.cell;
    const ddx = x - sites[3 * c];
    const ddy = y - sites[3 * c + 1];
    const ddz = z - sites[3 * c + 2];
    const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
    const q = node.axis === 0 ? x : node.axis === 1 ? y : z;
    const s = sites[3 * c + node.axis];
    const near = q < s ? node.left : node.right;
    const far = q < s ? node.right : node.left;
    visit(near);
    const split = q - s;
    if (split * split < bestD2) visit(far); // the other side could hold a closer point
  };
  visit(root);
  return best;
}
