import { SHADE_MIN_LAND_E } from "../../common/elevationBands";
import { isAridZone, isForestZone, isOceanZone } from "../../common/koppen";
import type { GlobeMap } from "../../common/map";
import { CONTINENTS, OCEANS } from "../../common/settings";
import { applyContrast } from "../../common/util";

export type TerrainKind = "MOUNTAINS" | "DESERT" | "FOREST";
export type TerrainComponent = { kind: TerrainKind; cells: number[] };

const KINDS: TerrainKind[] = ["MOUNTAINS", "DESERT", "FOREST"];

// A cell is MOUNTAINS once its (contrasted) land elevation reaches the HIGH band — the SAME threshold the
// renderer shades as mountains (SHADE_MIN_LAND_E). Köppen is climate-only, so the mountain label stays
// elevation-driven (deliberately outside the Köppen scope); deserts/forests are the climate (Köppen zone).
function isMountainElevation(elevation: number): boolean {
  const cwl = applyContrast(OCEANS.SEA_LEVEL.value, CONTINENTS.ELEVATION_CONTRAST.value);
  const ec = applyContrast(elevation, CONTINENTS.ELEVATION_CONTRAST.value);
  if (ec < cwl) return false; // ocean
  return (ec - cwl) / (1 - cwl) >= SHADE_MIN_LAND_E;
}

/**
 * A land cell's labelled terrain kind from its KÖPPEN zone (+ an elevation test for mountains), or null
 * (ocean, or unlabelled plains — grassland / savanna / steppe / mediterranean / tundra). Reads off the
 * same Köppen truth the colours do: deserts are the arid (B) zones, forests the humid tropical/temperate/
 * boreal zones.
 */
function terrainKindOf(map: GlobeMap, i: number): TerrainKind | null {
  const zone = map.koppenZone[i];
  if (isOceanZone(zone)) return null;
  if (isMountainElevation(map.elevation[i])) return "MOUNTAINS";
  if (isAridZone(zone)) return "DESERT";
  if (isForestZone(zone)) return "FOREST";
  return null; // grassland / savanna / steppe / mediterranean / tundra — left unlabelled (as before)
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
