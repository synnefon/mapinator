import type { GlobeMap } from "../../common/map";
import { coastDistances } from "./detect";

export type OceanRegion = {
  anchorCell: number;
  kind: "OCEAN" | "SEA";
  extent: number; // angular radius (rad) for font sizing — open oceans read bigger than marginal seas
};

// Tunables (mirrors the settings DIALS convention) for how the one connected water body is named.
export const OCEAN_NAMING = {
  CELLS_PER_NAME: 2500, // ~one ocean/sea label per this many connected-water cells
  MAX_NAMES: 14, // cap on labels for a single connected body
  OCEAN_MIN_COAST_HOPS: 6, // an anchor at least this far from any coast is open OCEAN, else marginal SEA
  SEA_MIN_COAST_HOPS: 3, // a SEA must be at least this far from shore — smaller anchors are coastal
  //                        nooks, not named seas (the deepest anchor is always kept regardless)
  MIN_EXTENT: 0.03, // rad: smallest label reach
  MAX_EXTENT: 0.32, // rad: largest label reach (keeps even a vast ocean's font in range)
};

/**
 * Break the single connected water body into several named regions, Earth-style: one connected ocean
 * carries many names ("… Ocean" in the open expanses, "… Sea" in the marginal pockets). Anchors are
 * spread by farthest-point sampling (count scales with the body's size), seeded at the deepest open
 * water; each is an OCEAN if it sits far from any coast or a SEA if it's near/encircled by land.
 * Deterministic: sites + the cell graph are fixed for a seed, and every tie breaks to the lowest index.
 */
export function subdivideOcean(
  cells: number[],
  map: GlobeMap,
  adjacency: number[][]
): OceanRegion[] {
  const { sites } = map;
  const coast = coastDistances(cells, adjacency);
  const cellAngle = Math.sqrt((4 * Math.PI) / map.cellCount); // ≈ a cell's angular diameter
  const target = Math.max(
    1,
    Math.min(OCEAN_NAMING.MAX_NAMES, Math.round(cells.length / OCEAN_NAMING.CELLS_PER_NAME))
  );

  // Farthest-point sampling. `nearestDot[i]` = the largest dot (smallest angle) from cells[i] to any
  // chosen anchor; the next anchor is the cell with the SMALLEST nearestDot (farthest from all so far).
  const nearestDot = new Float64Array(cells.length).fill(-Infinity);
  const anchors: number[] = [];

  const addAnchor = (cell: number): void => {
    anchors.push(cell);
    const ax = sites[3 * cell];
    const ay = sites[3 * cell + 1];
    const az = sites[3 * cell + 2];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const dot = ax * sites[3 * c] + ay * sites[3 * c + 1] + az * sites[3 * c + 2];
      if (dot > nearestDot[i]) nearestDot[i] = dot;
    }
  };

  // Seed at the pole of inaccessibility (deepest open water; ties → lowest cell index).
  let seed = cells[0];
  let seedHops = -1;
  for (const c of cells) {
    const h = coast.get(c) as number;
    if (h > seedHops) {
      seedHops = h;
      seed = c;
    }
  }
  addAnchor(seed);

  while (anchors.length < target) {
    let pick = -1;
    let pickDot = Infinity;
    for (let i = 0; i < cells.length; i++) {
      if (nearestDot[i] < pickDot) {
        pickDot = nearestDot[i];
        pick = i;
      }
    }
    if (pick < 0) break;
    addAnchor(cells[pick]);
  }

  const regions: OceanRegion[] = [];
  anchors.forEach((anchorCell, i) => {
    const hops = coast.get(anchorCell) as number;
    // A sea must be a real basin, not a coastal nook — drop anchors too close to shore. The deepest
    // anchor (i === 0, the pole of inaccessibility) is always kept so the body has at least one label.
    if (i > 0 && hops < OCEAN_NAMING.SEA_MIN_COAST_HOPS) return;
    const kind = hops >= OCEAN_NAMING.OCEAN_MIN_COAST_HOPS ? "OCEAN" : "SEA";
    const extent = Math.max(
      OCEAN_NAMING.MIN_EXTENT,
      Math.min(OCEAN_NAMING.MAX_EXTENT, hops * cellAngle) // openness drives label size
    );
    regions.push({ anchorCell, kind, extent });
  });
  return regions;
}
