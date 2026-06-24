import type { RawComponent } from "./detect";

export type FeatureKind =
  | "OCEAN"
  | "SEA"
  | "BAY"
  | "LAKE"
  | "ISLAND"
  | "MOUNTAINS"
  | "DESERT"
  | "FOREST";

// Thresholds are FRACTIONS of the planet's total cell count, so they're resolution-independent.
// Exposed as a mutable object for live tuning (mirrors the settings DIALS convention). OCEAN / SEA
// are NOT size-based — they're regions of the one connected water body (see ocean.ts); a water body
// that's its own component is landlocked, hence a LAKE whatever its size.
export const CLASSIFY = {
  MIN_FEATURE_FRAC: 0.0006, // islands below this share of the planet → skip (specks).
  CONTINENT_FRAC: 0.04, // a landmass at least this large is a continent (NOT labelled), else an island
  LARGE_MINOR_FRAC: 0.008, // an island at least this large is "large" (revealed one level earlier)
  TERRAIN_MIN_FRAC: 0.003, // deserts / forests below this share aren't labelled
  MOUNTAIN_MIN_FRAC: 0.002, // mountain ranges qualify a bit smaller than other terrain
  LAKE_MIN_FRAC: 0.0002, // lakes named down to here — well below the island floor, so there are MANY
  LAKE_TIERS: [0.008, 0.003, 0.0012], // frac ≥ these → reveal tier 1 / 2 / 3; smaller lakes → tier 4
};

// Smaller lakes reveal at deeper zoom: the first LAKE_TIERS threshold the fraction clears sets the
// tier (1-based), and anything below them all is the deepest tier.
function lakeMinLevel(frac: number): number {
  for (let i = 0; i < CLASSIFY.LAKE_TIERS.length; i++) if (frac >= CLASSIFY.LAKE_TIERS[i]) return i + 1;
  return CLASSIFY.LAKE_TIERS.length + 1;
}

export type MinorFeature = {
  kind: FeatureKind; // LAKE | ISLAND
  minLevel: number;
  repCell: number; // stable name seed (smallest member index)
  cellCount: number;
};

/**
 * Classify a SINGLE-label component — a landlocked lake or an island. Returns null below the size
 * floor (per class) and for continent-sized landmasses (continents are intentionally NOT labelled).
 * The connected ocean is handled separately (ocean.ts), so any water here is a lake. Lakes have a
 * much lower floor (many of them) and a size-graded reveal so smaller lakes appear at deeper zoom.
 */
export function classifyMinor(comp: RawComponent, totalCells: number): MinorFeature | null {
  const cellCount = comp.cells.length;
  const repCell = comp.cells.reduce((min, c) => (c < min ? c : min), comp.cells[0]);
  const frac = cellCount / totalCells;

  if (comp.cls === "land") {
    if (cellCount < CLASSIFY.MIN_FEATURE_FRAC * totalCells) return null;
    if (cellCount >= CLASSIFY.CONTINENT_FRAC * totalCells) return null; // continent — not labelled
    return { kind: "ISLAND", minLevel: frac >= CLASSIFY.LARGE_MINOR_FRAC ? 1 : 2, repCell, cellCount };
  }
  if (cellCount < CLASSIFY.LAKE_MIN_FRAC * totalCells) return null;
  return { kind: "LAKE", minLevel: lakeMinLevel(frac), repCell, cellCount };
}
