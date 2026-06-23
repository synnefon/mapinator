import type { GlobeMap } from "../../common/map";

export type ComponentClass = "water" | "land";

// A maximal connected run of same-class (water / land) cells. Naming/anchoring is computed later from
// `cells` — the ocean is subdivided into several labels (ocean.ts), everything else gets one each.
export type RawComponent = { cls: ComponentClass; cells: number[] };

/**
 * Flood-fill the cell adjacency graph into maximal same-class components. A cell is water iff its raw
 * elevation is below the live sea level — the exact split the renderer colours on (applyContrast is
 * monotonic, so raw elevation vs raw SEA_LEVEL matches the contrasted waterline). Iterative DFS.
 */
export function detectComponents(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][]
): RawComponent[] {
  const { cellCount, elevation } = map;
  const isWater = (i: number): boolean => elevation[i] < seaLevel;
  const visited = new Uint8Array(cellCount);
  const out: RawComponent[] = [];
  const stack: number[] = [];

  for (let s = 0; s < cellCount; s++) {
    if (visited[s]) continue;
    const water = isWater(s);
    visited[s] = 1;
    stack.length = 0;
    stack.push(s);
    const cells: number[] = [];
    while (stack.length) {
      const c = stack.pop() as number;
      cells.push(c);
      for (const n of adjacency[c]) {
        if (!visited[n] && isWater(n) === water) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push({ cls: water ? "water" : "land", cells });
  }
  return out;
}

/**
 * Hops from each member cell to the nearest NON-member (the component's edge / shoreline), via
 * multi-source BFS inward. Tells open interior (large distance) from edge-hugging cells (small) —
 * used both to anchor labels in the interior and to tell open ocean from marginal sea.
 */
export function coastDistances(cells: number[], adjacency: number[][]): Map<number, number> {
  const member = new Set(cells);
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (const c of cells) {
    for (const n of adjacency[c]) {
      if (!member.has(n)) {
        dist.set(c, 0);
        queue.push(c);
        break; // c is on the shoreline
      }
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi];
    const d = dist.get(c) as number;
    for (const n of adjacency[c]) {
      if (member.has(n) && !dist.has(n)) {
        dist.set(n, d + 1);
        queue.push(n);
      }
    }
  }
  // A component with no edge (covers the whole sphere) has no shoreline seeds → everyone distance 0.
  for (const c of cells) if (!dist.has(c)) dist.set(c, 0);
  return dist;
}

/** The member cell farthest (in hops) from the component's edge — its "pole of inaccessibility".
 *  Labelling here keeps the name in open interior, not on land a concave body wraps around. */
export function poleOfInaccessibility(cells: number[], adjacency: number[][]): number {
  const dist = coastDistances(cells, adjacency);
  let best = cells[0];
  let bestDist = -1;
  for (const c of cells) {
    const d = dist.get(c) as number;
    if (d > bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** Angular radius (rad) from a cell to the farthest member — a feature's on-sphere reach. */
export function angularExtent(anchorCell: number, cells: number[], sites: Float32Array): number {
  const ax = sites[3 * anchorCell];
  const ay = sites[3 * anchorCell + 1];
  const az = sites[3 * anchorCell + 2];
  let minDot = 1;
  for (const c of cells) {
    const d = ax * sites[3 * c] + ay * sites[3 * c + 1] + az * sites[3 * c + 2];
    if (d < minDot) minDot = d;
  }
  return Math.acos(Math.max(-1, Math.min(1, minDot)));
}
