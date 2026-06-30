import type { GlobeMap } from "../common/map";
import { buildAdjacency } from "../mapgen/features/adjacency";
import { buildKdTree, nearestCell } from "../mapgen/features/kdTree";

// Equirectangular country texture for the choropleth, sampled by world direction so the globe + detail
// patches tint at ANY zoom with no per-patch classification. RGB = the OWNING country's hue — land cells
// keep their own; water cells take the coast they're CONTIGUOUS with (a BFS out from land), so a fine
// patch cell that's land just past the blocky coarse coast reads the country it's attached to, not
// whatever foreign coast is Euclidean-nearest. ALPHA = a land/water flag (255 land / 0 sea) for the base
// globe's own coast; the detail patches ignore it and gate the tint on their OWN per-cell coast instead.
export const COUNTRY_TEX_W = 1024;
export const COUNTRY_TEX_H = 512;

// Choropleth palette, one RGB per colour class from colorCountries. Six classes (not four) give the
// greedy colouring enough slack to keep neighbours apart. Keep the entry count ≥ COLOR_CLASSES in
// mapgen/features/countries.ts.
export const HUES: ReadonlyArray<readonly [number, number, number]> = [
  [220, 70, 70], // red
  [235, 140, 50], // orange (was a water-like blue)
  [80, 180, 90], // green
  [220, 180, 60], // gold
  [150, 90, 205], // purple
  [55, 180, 200], // teal
];
/**
 * Bake the equirect country texture (RGBA8, COUNTRY_TEX_W×COUNTRY_TEX_H). First attribute EVERY cell to a
 * country by surface contiguity (BFS out from land over water — see `grown`), then per texel direction:
 * RGB = the nearest cell's owning country hue; ALPHA = 255 if that cell is land else 0 (the base globe's
 * own coast). Shader inverse mapping: u = atan2(z,x)/2π + ½, v = asin(y)/π + ½.
 */
export function bakeCountryTexture(
  map: GlobeMap,
  countryOf: Int32Array,
  countryColors: Int32Array
): Uint8Array {
  const tree = buildKdTree(map.sites, map.cellCount);
  // Attribute every cell to a country by SURFACE CONTIGUITY, not Euclidean distance: seed from the land
  // cells (each its own country) and BFS outward over water by hop distance, so a water cell — and the
  // fine coastal land that sits over it, past the blocky coarse coast — is owned by the coast it's
  // actually CONNECTED to. Nearest-land-cell alone hops across straits + mis-colours small-island rings,
  // because the Euclidean-closest coarse land can belong to a different country than the cell's own coast.
  const adjacency = buildAdjacency(map);
  const grown = new Int32Array(map.cellCount).fill(-1);
  let frontier: number[] = [];
  for (let c = 0; c < map.cellCount; c++) {
    if (countryOf[c] >= 0) {
      grown[c] = countryOf[c];
      frontier.push(c);
    }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) {
      for (const nb of adjacency[c]) {
        if (grown[nb] < 0) {
          grown[nb] = grown[c];
          next.push(nb);
        }
      }
    }
    frontier = next;
  }

  const data = new Uint8Array(COUNTRY_TEX_W * COUNTRY_TEX_H * 4);
  for (let ty = 0; ty < COUNTRY_TEX_H; ty++) {
    const lat = ((ty + 0.5) / COUNTRY_TEX_H - 0.5) * Math.PI;
    const cosLat = Math.cos(lat);
    const dy = Math.sin(lat);
    for (let tx = 0; tx < COUNTRY_TEX_W; tx++) {
      const lon = ((tx + 0.5) / COUNTRY_TEX_W - 0.5) * 2 * Math.PI;
      const x = cosLat * Math.cos(lon);
      const z = cosLat * Math.sin(lon);
      const o = (ty * COUNTRY_TEX_W + tx) * 4;
      const c = nearestCell(tree, map.sites, x, dy, z);
      const ci = grown[c]; // owning country (land = its own; water = nearest coast by contiguity)
      if (ci >= 0) {
        const hue = HUES[countryColors[ci]] ?? HUES[0];
        data[o] = hue[0];
        data[o + 1] = hue[1];
        data[o + 2] = hue[2];
      }
      data[o + 3] = countryOf[c] >= 0 ? 255 : 0; // land flag (the base globe's own coast)
    }
  }
  return data;
}
