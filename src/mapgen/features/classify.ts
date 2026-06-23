import type { RawComponent } from "./detect";

export type FeatureKind =
  | "OCEAN"
  | "SEA"
  | "LAKE"
  | "CONTINENT"
  | "ISLAND"
  | "MOUNTAINS"
  | "DESERT"
  | "FOREST";

// Thresholds are FRACTIONS of the planet's total cell count, so they're resolution-independent.
// Exposed as a mutable object for live tuning (mirrors the settings DIALS convention). OCEAN / SEA
// are NOT size-based — they're regions of the one connected water body (see ocean.ts); a water body
// that's its own component is landlocked, hence a LAKE whatever its size.
export const CLASSIFY = {
  MIN_FEATURE_FRAC: 0.0006, // below this share of the planet → skip (specks). Low, so small lakes /
  //                           islands still get NAMED — they're just revealed at a higher zoom.
  CONTINENT_FRAC: 0.04, // a landmass at least this large is a continent, else an island
  LARGE_MINOR_FRAC: 0.008, // a lake / island at least this large is "large" (revealed one level earlier)
  TERRAIN_MIN_FRAC: 0.003, // deserts / forests below this share aren't labelled
  MOUNTAIN_MIN_FRAC: 0.002, // mountain ranges qualify a bit smaller than other terrain
};

export type MinorFeature = {
  kind: FeatureKind; // LAKE | CONTINENT | ISLAND
  minLevel: number;
  repCell: number; // stable name seed (smallest member index)
  cellCount: number;
};

/**
 * Classify a SINGLE-label component — a landlocked lake or a landmass. Returns null for components
 * below the noise floor. The connected ocean is handled separately (ocean.ts), so any water here is a
 * lake. minLevel reveal tier: 0 = continents (and oceans), 1 = seas + large lakes/islands, 2 = rest.
 */
export function classifyMinor(comp: RawComponent, totalCells: number): MinorFeature | null {
  const cellCount = comp.cells.length;
  if (cellCount < CLASSIFY.MIN_FEATURE_FRAC * totalCells) return null;

  const repCell = comp.cells.reduce((min, c) => (c < min ? c : min), comp.cells[0]);
  const frac = cellCount / totalCells;

  let kind: FeatureKind;
  let minLevel: number;
  if (comp.cls === "land") {
    if (cellCount >= CLASSIFY.CONTINENT_FRAC * totalCells) {
      kind = "CONTINENT";
      minLevel = 0;
    } else {
      kind = "ISLAND";
      minLevel = frac >= CLASSIFY.LARGE_MINOR_FRAC ? 1 : 2;
    }
  } else {
    kind = "LAKE"; // a non-ocean water body is landlocked
    minLevel = frac >= CLASSIFY.LARGE_MINOR_FRAC ? 1 : 2;
  }
  return { kind, minLevel, repCell, cellCount };
}
