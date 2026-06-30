import { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import type { RawComponent } from "./detect";

// Cells whose polygon rings share an EDGE (≥2 corners) are neighbours. The mesh is the watertight
// Goldberg dual, but each cell emits its ring vertices independently, so the same corner can differ
// by a hair between cells — quantise to a grid before matching so shared corners hash equal.
const QUANT = 1e5; // round unit-sphere coords to ~1e-5 before hashing

/** A ring vertex's hash key — shared corners between cells (computed independently) quantise equal. */
export const vertexKey = (x: number, y: number, z: number): string =>
  `${Math.round(x * QUANT)}|${Math.round(y * QUANT)}|${Math.round(z * QUANT)}`;

/**
 * Per-cell neighbour lists for the base globe, built from shared ring edges. Two cells that share
 * two ring corners share an edge and are neighbours; a single shared corner (cells meeting only at
 * a point) is not adjacency. O(total ring vertices). Used to flood-fill cells into features.
 */
export function buildAdjacency(map: Pick<GlobeMap, "cellCount" | "ringOffsets" | "ringVerts">): number[][] {
  const { cellCount, ringOffsets, ringVerts } = map;

  // corner key -> cells touching that corner
  const vertexCells = new Map<string, number[]>();
  for (let i = 0; i < cellCount; i++) {
    const seen = new Set<string>(); // a closed ring can repeat its first corner — count each once
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) {
      const k = vertexKey(ringVerts[3 * v], ringVerts[3 * v + 1], ringVerts[3 * v + 2]);
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

/** Multi-source BFS over LAND cells: each land cell's hops to the nearest water cell flagged by
 *  `isSourceWater` (a land cell touching such water is 0). Water cells stay -1, as do land cells that
 *  reach no flagged water. Land is `elevation ≥ seaLevel`. Shared by country population (the coastal
 *  density bonus) and city placement (the coast pull). */
export function waterHopDistance(
  map: GlobeMap,
  seaLevel: number,
  adjacency: number[][],
  isSourceWater: (i: number) => boolean
): Int32Array {
  const { cellCount, elevation } = map;
  const isLand = (i: number): boolean => elevation[i] >= seaLevel;
  const dist = new Int32Array(cellCount).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < cellCount; i++) {
    if (!isLand(i)) continue;
    for (const nb of adjacency[i]) {
      if (isSourceWater(nb)) {
        dist[i] = 0;
        queue.push(i);
        break;
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    const next = dist[c] + 1;
    for (const nb of adjacency[c]) {
      if (isLand(nb) && dist[nb] === -1) {
        dist[nb] = next;
        queue.push(nb);
      }
    }
  }
  return dist;
}

/** Each land cell's distance, in graph hops, to the nearest water of ANY kind (lake or sea) — a
 *  multi-source BFS out from the coastline (a land cell touching water is 0). Water cells stay -1. */
export function coastDistance(map: GlobeMap, seaLevel: number, adjacency: number[][]): Int32Array {
  return waterHopDistance(map, seaLevel, adjacency, (i) => map.elevation[i] < seaLevel);
}

// A water body counts as "large" (a sea/ocean, not a lake/pond) if it's the biggest water body OR spans at
// least this fraction of all cells. Resolution-independent (a fraction of the cell count).
const LARGE_WATER_FRAC = 0.01;

/** Per-cell flag (1/0): is this cell part of a LARGE water body? The single biggest water component always
 *  counts (these worlds always have an ocean); others count once they clear LARGE_WATER_FRAC. Takes the
 *  already-detected components so the caller doesn't re-flood-fill. */
export function largeWaterMask(components: RawComponent[], cellCount: number): Uint8Array {
  const mask = new Uint8Array(cellCount);
  const water = components.filter((c) => c.cls === "water");
  if (water.length === 0) return mask;
  const threshold = LARGE_WATER_FRAC * cellCount;
  const largest = water.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
  for (const comp of water) {
    if (comp === largest || comp.cells.length >= threshold) {
      for (const cell of comp.cells) mask[cell] = 1;
    }
  }
  return mask;
}

/** Per land cell, the unit direction toward its nearest bordering WATER cell (0,0,0 if it touches no water).
 *  The shore snap marches a settlement along this to the fine waterline, so the marker sits on the coast.
 *  Computed where the mesh adjacency lives (main thread) + shipped to the worker so both snap identically. */
export function buildCoastDir(map: GlobeMap, adjacency: number[][], seaLevel: number): Float32Array {
  const { cellCount, sites, elevation } = map;
  const dir = new Float32Array(3 * cellCount);
  for (let i = 0; i < cellCount; i++) {
    if (elevation[i] < seaLevel) continue; // water cell — no shore direction
    const cx = sites[3 * i];
    const cy = sites[3 * i + 1];
    const cz = sites[3 * i + 2];
    let best = -1;
    let bestDot = -Infinity;
    for (const nb of adjacency[i]) {
      if (elevation[nb] >= seaLevel) continue; // only head toward water neighbours
      const dot = cx * sites[3 * nb] + cy * sites[3 * nb + 1] + cz * sites[3 * nb + 2];
      if (dot > bestDot) {
        bestDot = dot; // largest dot ⇒ smallest angle ⇒ nearest water neighbour
        best = nb;
      }
    }
    if (best < 0) continue;
    const d = Vec3.normalize({ x: sites[3 * best] - cx, y: sites[3 * best + 1] - cy, z: sites[3 * best + 2] - cz });
    dir[3 * i] = d.x;
    dir[3 * i + 1] = d.y;
    dir[3 * i + 2] = d.z;
  }
  return dir;
}
