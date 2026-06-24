import type { GlobeMap } from "../common/map";

// Equirectangular country-colour texture for the choropleth. Each texel is the country colour of the
// NEAREST base cell in that direction (or a dark sea for country-less water), so the globe and the
// detail-patch shaders can sample the tint by world direction at ANY zoom — the tint follows the patch
// without per-patch classification. RGB = tint colour, A = blend amount (alpha doubles as the mix).
export const COUNTRY_TEX_W = 1024;
export const COUNTRY_TEX_H = 512;

// Same four hues as the old per-cell choropleth; opaque, since the blend amount lives in alpha.
const HUES: ReadonlyArray<readonly [number, number, number]> = [
  [220, 70, 70],
  [70, 120, 220],
  [80, 180, 90],
  [220, 180, 60],
];
const LAND_BLEND = Math.round(0.5 * 255); // country hue mixed over the terrain
const OCEAN_BLEND = Math.round(0.6 * 255); // black mixed over the sea

/**
 * Bake the equirect country texture (RGBA8, COUNTRY_TEX_W×COUNTRY_TEX_H). Texel (tx,ty) maps to a
 * direction on the unit sphere; its nearest base cell's country sets the texel's colour + blend amount.
 * The shader's inverse mapping must match: u = atan2(z,x)/2π + ½, v = asin(y)/π + ½. Run per map / toggle.
 */
export function bakeCountryTexture(
  map: GlobeMap,
  countryOf: Int32Array,
  countryColors: Int32Array
): Uint8Array {
  const tree = buildKdTree(map.sites, map.cellCount);
  const data = new Uint8Array(COUNTRY_TEX_W * COUNTRY_TEX_H * 4);
  for (let ty = 0; ty < COUNTRY_TEX_H; ty++) {
    const lat = ((ty + 0.5) / COUNTRY_TEX_H - 0.5) * Math.PI;
    const cosLat = Math.cos(lat);
    const dy = Math.sin(lat);
    for (let tx = 0; tx < COUNTRY_TEX_W; tx++) {
      const lon = ((tx + 0.5) / COUNTRY_TEX_W - 0.5) * 2 * Math.PI;
      const cell = nearestCell(tree, map.sites, cosLat * Math.cos(lon), dy, cosLat * Math.sin(lon));
      const ci = countryOf[cell];
      const o = (ty * COUNTRY_TEX_W + tx) * 4;
      if (ci >= 0) {
        const hue = HUES[countryColors[ci]] ?? HUES[0];
        data[o] = hue[0];
        data[o + 1] = hue[1];
        data[o + 2] = hue[2];
        data[o + 3] = LAND_BLEND;
      } else {
        data[o + 3] = OCEAN_BLEND; // rgb left 0 = black sea
      }
    }
  }
  return data;
}

/** A 3D kd-tree over the base cell sites, for nearest-cell-to-a-direction lookups during the bake. */
type KdNode = { cell: number; axis: number; left: KdNode | null; right: KdNode | null };

function buildKdTree(sites: Float32Array, n: number): KdNode | null {
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

/** Nearest base cell to direction (x,y,z), by squared Euclidean distance (monotonic in angle here). */
function nearestCell(root: KdNode | null, sites: Float32Array, x: number, y: number, z: number): number {
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
