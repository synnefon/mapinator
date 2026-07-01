import type { Vec3 } from "../../common/3DMath";
import type { GlobeMap } from "../../common/map";
import { CITIES, type TerrainParams } from "../../common/settings";
import { buildCpuCalc, type CpuCalc } from "../gpu/cpuField";
import { buildAdjacency, buildCoastDir, coastDistance, largeWaterMask, waterHopDistance } from "./adjacency";
import { detectComponents, type RawComponent } from "./detect";
import { inlandRisenElevation } from "./inlandElevation";
import { buildKdTree, nearestCell } from "./kdTree";
import type { RiverData } from "./rivers";
import { buildRiverGrid, RIVER_GRID_CELLS, type RiverGrid } from "./settlements";

/**
 * The country-independent lookups every feature step reads — the wiring of the base globe into
 * fields the pipeline (countries → cities → labels) consumes. Assembled ONCE per
 * computeMapFeatures run, in one tested place, instead of inline between the steps: each field's
 * meaning (and which step needs it) is stated here, and a fixture-built map exercises the whole
 * assembly without generating a real globe (the SettlementWorld discipline, one level up).
 */
export type WorldContext = {
  adjacency: number[][]; // per-cell neighbour lists (shared ring edges)
  components: RawComponent[]; // connected land/water components at this sea level
  reportElevation: Float32Array; // inland-RISEN display elevation — countries' population input
  largeWater: Uint8Array; // per cell: 1 if part of a SEA-sized water body (not a pond)
  coastDist: Int32Array; // land → hops to nearest water of ANY kind (-1 on water)
  seaDist: Int32Array; // land → hops to nearest LARGE water (-1 if unreachable)
  coastDir: Float32Array; // 3/cell: unit direction toward the nearest water cell (shore snap)
  cellSpacing: number; // base cell angular spacing (rad) — sizes the river thresholds
  riverGrid: RiverGrid | null; // the drawn large-river network, spatially hashed
  cpu: CpuCalc; // the generator's FINE field re-derived on this thread (renderer-exact)
  nearestCellAt: (p: Vec3) => number; // kd-tree lookup: sphere point → nearest base cell
};

/** Build the context. Pure given its inputs (deterministic, no RNG), so hoisting any field's
 *  computation relative to the country/city steps can never change a result. */
export function buildWorldContext(
  map: GlobeMap,
  seaLevel: number,
  mapSeed: string,
  params: TerrainParams,
  rivers: RiverData
): WorldContext {
  const adjacency = buildAdjacency(map);
  const components = detectComponents(map, seaLevel, adjacency);
  // The continental inland rise as an explicit display-elevation field (pure — no map mutation),
  // handed to countries as a named input so the coast→interior gradient that feeds the population
  // lapse rate can't be reordered away.
  const reportElevation = inlandRisenElevation(map, seaLevel, adjacency, components);
  // The water arrays the one settlement engine routes + biases on, computed here where the mesh
  // adjacency lives; the SAME arrays are shipped to the worker so the patch-local tail routes
  // identically (main.ts broadcast).
  const largeWater = largeWaterMask(components, map.cellCount);
  const coastDist = coastDistance(map, seaLevel, adjacency);
  const seaDist = waterHopDistance(map, seaLevel, adjacency, (i) => largeWater[i] === 1);
  const coastDir = buildCoastDir(map, adjacency, seaLevel);
  const cellSpacing = Math.sqrt((4 * Math.PI) / map.cellCount);
  const riverGrid = buildRiverGrid(rivers.positions, rivers.widths, CITIES.RIVER_MIN_STRENGTH.value, RIVER_GRID_CELLS * cellSpacing);
  // Re-derive the generator's FINE field on this thread (the base map was built in a worker) so the
  // settlement engine's density + coastal snap read the same field the renderer draws.
  const cpu = buildCpuCalc(mapSeed, params);
  const tree = buildKdTree(map.sites, map.cellCount);
  const nearestCellAt = (p: Vec3): number => nearestCell(tree, map.sites, p.x, p.y, p.z);
  return { adjacency, components, reportElevation, largeWater, coastDist, seaDist, coastDir, cellSpacing, riverGrid, cpu, nearestCellAt };
}
