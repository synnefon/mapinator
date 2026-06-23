import type { GlobeMap } from "../../common/map";

// Cells whose polygon rings share an EDGE (≥2 corners) are neighbours. The mesh is the watertight
// Goldberg dual, but each cell emits its ring vertices independently, so the same corner can differ
// by a hair between cells — quantise to a grid before matching so shared corners hash equal.
const QUANT = 1e5; // round unit-sphere coords to ~1e-5 before hashing

const vKey = (x: number, y: number, z: number): string =>
  `${Math.round(x * QUANT)}|${Math.round(y * QUANT)}|${Math.round(z * QUANT)}`;

/**
 * Per-cell neighbour lists for the base globe, built from shared ring edges. Two cells that share
 * two ring corners share an edge and are neighbours; a single shared corner (cells meeting only at
 * a point) is not adjacency. O(total ring vertices). Used to flood-fill cells into features.
 */
export function buildAdjacency(map: GlobeMap): number[][] {
  const { cellCount, ringOffsets, ringVerts } = map;

  // corner key -> cells touching that corner
  const vertexCells = new Map<string, number[]>();
  for (let i = 0; i < cellCount; i++) {
    const seen = new Set<string>(); // a closed ring can repeat its first corner — count each once
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) {
      const k = vKey(ringVerts[3 * v], ringVerts[3 * v + 1], ringVerts[3 * v + 2]);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = vertexCells.get(k);
      if (list) list.push(i);
      else vertexCells.set(k, [i]);
    }
  }

  // Count shared corners per cell pair; the pair becomes neighbours the moment it reaches two.
  const sharedCount = new Map<number, number>();
  const neighbors: number[][] = Array.from({ length: cellCount }, () => []);
  for (const cells of vertexCells.values()) {
    for (let a = 0; a < cells.length; a++) {
      for (let b = a + 1; b < cells.length; b++) {
        const lo = Math.min(cells[a], cells[b]);
        const hi = Math.max(cells[a], cells[b]);
        const pair = lo * cellCount + hi;
        const count = (sharedCount.get(pair) ?? 0) + 1;
        sharedCount.set(pair, count);
        if (count === 2) {
          neighbors[lo].push(hi);
          neighbors[hi].push(lo);
        }
      }
    }
  }
  return neighbors;
}
