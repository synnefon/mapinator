import type { Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import type { GlobeMap } from "../../common/map";
import type { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { CLASSIFY, classifyMinor, type FeatureKind } from "./classify";
import { angularExtent, detectComponents, poleOfInaccessibility, type RawComponent } from "./detect";
import { nameFeature } from "./name";
import { subdivideOcean } from "./ocean";
import { detectTerrainFeatures } from "./terrain";

export { CLASSIFY, type FeatureKind } from "./classify";
export { OCEAN_NAMING } from "./ocean";

export type MapFeature = {
  kind: FeatureKind;
  name: string;
  anchor: Vec3; // unit-sphere interior point — where the label sits
  cellCount: number; // ≈ area, used as label priority (declutter)
  extent: number; // angular radius (rad) — drives on-screen font size + visibility
  minLevel: number; // lowest LOD zoom level the label may show at (0 continents/oceans … 2 the rest)
};

const siteVec = (map: GlobeMap, cell: number): Vec3 => ({
  x: map.sites[3 * cell],
  y: map.sites[3 * cell + 1],
  z: map.sites[3 * cell + 2],
});

/**
 * Identify, classify, and name every major feature on the base globe. Pure given its inputs, so the
 * caller memoises it on (map, seaLevel, language). The largest water component is the connected
 * ocean/sea network — it carries SEVERAL names spread across it (open oceans + marginal seas); every
 * other water body is a landlocked lake; land is continents/islands by size. Run on the whole-globe
 * rung only (detail patches are partial and would split features).
 */
export function computeMapFeatures(
  map: GlobeMap,
  seaLevel: number,
  language: Language,
  mapSeed: string,
  namer: NameGenerator
): MapFeature[] {
  const adjacency = buildAdjacency(map);
  const components = detectComponents(map, seaLevel, adjacency);

  // The largest water component is the connected ocean; every other water body is landlocked.
  let ocean: RawComponent | null = null;
  for (const c of components) {
    if (c.cls === "water" && (!ocean || c.cells.length > ocean.cells.length)) ocean = c;
  }

  const features: MapFeature[] = [];

  // Connected ocean → several spread-out ocean/sea labels.
  if (ocean) {
    for (const region of subdivideOcean(ocean.cells, map, adjacency)) {
      features.push({
        kind: region.kind,
        name: nameFeature(region.kind, mapSeed, region.anchorCell, language, namer),
        anchor: siteVec(map, region.anchorCell),
        cellCount: Math.round(region.extent * map.cellCount), // size proxy for declutter priority
        extent: region.extent,
        minLevel: region.kind === "OCEAN" ? 0 : 1,
      });
    }
  }

  // Lakes (disconnected water) + land → one label each, kept above the noise floor.
  for (const comp of components) {
    if (comp === ocean) continue;
    const minor = classifyMinor(comp, map.cellCount);
    if (!minor) continue;
    const anchorCell = poleOfInaccessibility(comp.cells, adjacency);
    features.push({
      kind: minor.kind,
      name: nameFeature(minor.kind, mapSeed, minor.repCell, language, namer),
      anchor: siteVec(map, anchorCell),
      cellCount: minor.cellCount,
      extent: angularExtent(anchorCell, comp.cells, map.sites),
      minLevel: minor.minLevel,
    });
  }

  // Terrain regions on the land — deserts, forests, mountain ranges — labelled when large enough.
  // Mountains qualify a bit smaller than deserts/forests.
  for (const t of detectTerrainFeatures(map, adjacency)) {
    const minFrac = t.kind === "MOUNTAINS" ? CLASSIFY.MOUNTAIN_MIN_FRAC : CLASSIFY.TERRAIN_MIN_FRAC;
    if (t.cells.length < minFrac * map.cellCount) continue;
    const repCell = t.cells.reduce((min, c) => (c < min ? c : min), t.cells[0]);
    const anchorCell = poleOfInaccessibility(t.cells, adjacency);
    features.push({
      kind: t.kind,
      name: nameFeature(t.kind, mapSeed, repCell, language, namer),
      anchor: siteVec(map, anchorCell),
      cellCount: t.cells.length,
      extent: angularExtent(anchorCell, t.cells, map.sites),
      minLevel: t.cells.length / map.cellCount >= CLASSIFY.LARGE_MINOR_FRAC ? 1 : 2,
    });
  }

  return features;
}
