import type { GlobeMap } from "../common/map";
import { buildKdTree, nearestCell } from "../mapgen/features/kdTree";

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
