import type { Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import type { GlobeMap } from "../../common/map";
import { COUNTRIES, CITIES, POPULATION, type TerrainParams } from "../../common/settings";
import type { NameGenerator } from "../NameGenerator";
import { CLASSIFY, classifyMinor, type FeatureKind } from "./classify";
import { assembleCities } from "./cityStats";
import {
  assignCountries,
  colorCountries,
  growCountriesOverWater,
  largestBorderingCountry,
  refineCountryBorders,
} from "./countries";
import { angularExtent, poleOfInaccessibility, type RawComponent } from "./detect";
import type { Tags } from "./government";
import { nameFeature } from "./name";
import { subdivideOcean } from "./ocean";
import type { RiverData } from "./rivers";
import { makeSettlementWorld, type Settlement } from "./settlements";
import { detectTerrainFeatures } from "./terrain";
import { buildWorldContext } from "./worldContext";

export type { Settlement, SettlementTier, SettlementWaterKind } from "./settlements";
export { CLASSIFY, type FeatureKind } from "./classify";
export { OCEAN_NAMING } from "./ocean";

export type MapFeature = {
  kind: FeatureKind;
  name: string;
  anchor: Vec3; // unit-sphere interior point — where the label sits
  cellCount: number; // ≈ area, used as label priority (declutter)
  extent: number; // angular radius (rad) — drives on-screen font size + visibility
  minLevel: number; // lowest LOD zoom level the label may show at (0 oceans + seas … 2 the rest)
};

/** A country for the political overlay: its interactive label + the facts the click popup shows. */
export type CountryInfo = {
  index: number; // matches values in `countryOf` — used to highlight the country's territory on hover
  name: string;
  language: Language;
  government: string;
  govTags: Tags; // the government's semantic tags — drives a settlement marker's industries + fun facts (tail towns)
  population: number;
  areaKm2: number;
  anchor: Vec3; // where the (red) label sits
  extent: number; // angular radius (rad) for label sizing
  insRadius: number; // inscribed radius (rad) — how far the label may slide from the anchor + stay interior
};

/** Everything the label/country overlays need, computed once per (map, sea level, language). */
export type MapFeatures = {
  features: MapFeature[];
  countries: CountryInfo[];
  cities: Settlement[]; // the big-city HEAD — the settlement field over the whole sphere ≥ the global split
  borders: Float32Array; // flat [x0,y0,z0, x1,y1,z1, …] unit-sphere border segment pairs
  countryOf: Int32Array; // per cell: country index (matches CountryInfo.index), or -1 for ocean
  grownCountryOf: Int32Array; // countryOf grown over water by contiguity — every cell has a country (the base
  // partition the workers sample to stamp each patch cell at generation; see growCountriesOverWater)
  countryColors: Int32Array; // per country index: a colour class for the choropleth fill (see colorCountries)
};

const siteVec = (map: GlobeMap, cell: number): Vec3 => ({
  x: map.sites[3 * cell],
  y: map.sites[3 * cell + 1],
  z: map.sites[3 * cell + 2],
});

/**
 * Identify, classify, and name every major feature on the base globe, AND partition the land into
 * countries. Pure given its inputs, so the caller memoises it on (map, seaLevel, language).
 *
 * Naming is country-aware: a land feature takes the language of the country at its anchor; a water
 * body takes the language of its largest bordering country (else the map language). The largest
 * water component is the connected ocean/sea network (several spread-out names); every other water
 * body is a landlocked lake; land is labelled as islands by size (continents are not labelled), with
 * deserts/forests/mountain ranges overlaid. Run on the whole-globe rung only (patches split features).
 */
export function computeMapFeatures(
  map: GlobeMap,
  seaLevel: number,
  language: Language,
  mapSeed: string,
  namer: NameGenerator,
  languagePool: Language[],
  params: TerrainParams,
  rivers: RiverData
): MapFeatures {
  // Every country-independent lookup (adjacency, components, risen elevation, the water fields,
  // the river grid, the fine CPU field, the kd-tree) — assembled + documented in ONE tested unit.
  const ctx = buildWorldContext(map, seaLevel, mapSeed, params, rivers);
  const { adjacency, components, reportElevation } = ctx;
  // Start a clean uniqueness namespace for this generation: countries claim names first, then cities,
  // then features (all via `namer`), so no two named things anywhere share a name. Resetting each call
  // keeps it deterministic — a fixed seed re-derives the same names instead of drifting across regens.
  namer.resetUniqueness();
  const countryData = assignCountries(
    map,
    reportElevation,
    seaLevel,
    adjacency,
    mapSeed,
    language,
    languagePool,
    namer
  );
  const { countryOf, countries } = countryData;
  // The base partition grown over water by contiguity — every cell (even open water) maps to a country, so a
  // coastal settlement whose nearest base cell is water still gets claimed. Broadcast to the workers so each
  // patch cell is country-stamped at GENERATION (nearest base cell), and the SAME partition seeds the head +
  // tail settlement field's countryAt.
  const grownCountryOf = growCountriesOverWater(adjacency, countryOf, map.cellCount);
  // The one SettlementWorld — the SAME engine + routes the worker builds for the tail (makeSettlementWorld).
  const world = makeSettlementWorld({
    sampleCell: (p) => ctx.cpu.calc.sampleCell(p),
    seaLevel,
    nearestCell: ctx.nearestCellAt,
    countryOf: grownCountryOf,
    coastDist: ctx.coastDist,
    seaDist: ctx.seaDist,
    coastDir: ctx.coastDir,
    riverGrid: ctx.riverGrid,
    cellSpacing: ctx.cellSpacing,
    densityScale: POPULATION.GLOBAL_POPULATION_DENSITY.value,
    coastStrength: POPULATION.COAST_STRENGTH.value,
    coastFalloff: POPULATION.COAST_FALLOFF.value,
    desertAversion: CITIES.DESERT_AVERSION.value,
    iceAversion: CITIES.ICE_AVERSION.value,
  });
  const cities = assembleCities({ map, seaLevel, world, countries, countryOf, mapSeed, namer });
  const countryColors = colorCountries(countryOf, adjacency, countries.length);

  // A land feature speaks the language of the country at its anchor; a water body the language of
  // its largest bordering country. Both fall back to the map language.
  const landLang = (cell: number): Language => {
    const ci = countryOf[cell];
    return ci >= 0 ? countries[ci].language : language;
  };
  const waterLang = (cell: number): Language => {
    const ci = largestBorderingCountry(cell, map, seaLevel, adjacency, countryData);
    return ci >= 0 ? countries[ci].language : language;
  };

  // The largest water component is the connected ocean; every other water body is landlocked.
  let ocean: RawComponent | null = null;
  for (const c of components) {
    if (c.cls === "water" && (!ocean || c.cells.length > ocean.cells.length)) ocean = c;
  }

  const features: MapFeature[] = [];

  // Connected ocean → several spread-out ocean/sea labels (named by local bordering country).
  if (ocean) {
    for (const region of subdivideOcean(ocean.cells, map, adjacency)) {
      features.push({
        kind: region.kind,
        name: nameFeature(region.kind, mapSeed, region.anchorCell, waterLang(region.anchorCell), namer, true),
        anchor: siteVec(map, region.anchorCell),
        cellCount: Math.round(region.extent * map.cellCount), // size proxy for declutter priority
        extent: region.extent,
        minLevel: region.kind === "BAY" ? 1 : 0, // oceans + seas on the globe view; bays from zoom 1
      });
    }
  }

  // Lakes (disconnected water) + land → one label each, kept above the noise floor.
  for (const comp of components) {
    if (comp === ocean) continue;
    const minor = classifyMinor(comp, map.cellCount);
    if (!minor) continue;
    const anchorCell = poleOfInaccessibility(comp.cells, adjacency);
    const lang = minor.kind === "LAKE" ? waterLang(anchorCell) : landLang(anchorCell);
    features.push({
      kind: minor.kind,
      name: nameFeature(minor.kind, mapSeed, minor.repCell, lang, namer, true),
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
      name: nameFeature(t.kind, mapSeed, repCell, landLang(anchorCell), namer, true),
      anchor: siteVec(map, anchorCell),
      cellCount: t.cells.length,
      extent: angularExtent(anchorCell, t.cells, map.sites),
      minLevel: t.cells.length / map.cellCount >= CLASSIFY.LARGE_MINOR_FRAC ? 1 : 2,
    });
  }

  return {
    features,
    countries: countries.map((c) => ({
      index: c.index,
      name: c.name,
      language: c.language,
      government: c.government,
      govTags: c.govType.tags,
      population: c.population,
      areaKm2: c.areaKm2,
      anchor: siteVec(map, c.anchorCell),
      extent: c.extent,
      insRadius: c.insRadius,
    })),
    cities,
    // Refined ONCE here (compute-once vector overlay, like rivers): the coarse inter-country edges,
    // chained + fractally subdivided so detail resolves on zoom with no per-patch recompute.
    borders: refineCountryBorders(map, countryOf, { levels: COUNTRIES.BORDER_DETAIL.value, amplitude: COUNTRIES.BORDER_WIGGLE.value }),
    countryOf,
    grownCountryOf,
    countryColors,
  };
}
