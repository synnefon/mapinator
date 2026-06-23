import type { GlobeMap } from "../../common/map";
import { terrainClassOf } from "../../renderer/BiomeColor";

export type TerrainKind = "MOUNTAINS" | "DESERT" | "FOREST";
export type TerrainComponent = { kind: TerrainKind; cells: number[] };

const KINDS: TerrainKind[] = ["MOUNTAINS", "DESERT", "FOREST"];

/**
 * A land cell's labelled terrain kind from its biome (or null = ocean / mid-moisture plains, which
 * we leave unnamed). Matches the rendered colour: mountains are the high rock/snow band; desert is
 * dry low/medium land; forest is wet low/medium land.
 */
function terrainKindOf(map: GlobeMap, i: number): TerrainKind | null {
  const c = terrainClassOf(map.elevation[i], map.moisture[i], map.rainfall);
  if (!c) return null;
  if (c.family === "HIGH" || c.family === "VERY_HIGH") return "MOUNTAINS";
  if (c.band === "DRY") return "DESERT";
  if (c.band === "WET") return "FOREST";
  return null; // mid-moisture lowland — plains, left unlabelled
}

/**
 * Flood-fill connected runs of the same labelled terrain kind (mountain ranges, deserts, forests)
 * over the cell graph. These overlay the land features — a continent can carry several of them.
 */
export function detectTerrainFeatures(map: GlobeMap, adjacency: number[][]): TerrainComponent[] {
  const { cellCount } = map;
  const kindIdx = new Int8Array(cellCount).fill(-1);
  for (let i = 0; i < cellCount; i++) {
    const k = terrainKindOf(map, i);
    if (k) kindIdx[i] = KINDS.indexOf(k);
  }

  const visited = new Uint8Array(cellCount);
  const out: TerrainComponent[] = [];
  const stack: number[] = [];
  for (let s = 0; s < cellCount; s++) {
    if (visited[s] || kindIdx[s] < 0) continue;
    const k = kindIdx[s];
    visited[s] = 1;
    stack.length = 0;
    stack.push(s);
    const cells: number[] = [];
    while (stack.length) {
      const c = stack.pop() as number;
      cells.push(c);
      for (const n of adjacency[c]) {
        if (!visited[n] && kindIdx[n] === k) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push({ kind: KINDS[k], cells });
  }
  return out;
}
