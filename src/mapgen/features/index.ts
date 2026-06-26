import type { Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import type { GlobeMap } from "../../common/map";
import type { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { CLASSIFY, classifyMinor, type FeatureKind } from "./classify";
import { assignCities, type City } from "./cities";
import {
  assignCountries,
  countryBorderSegments,
  fourColorCountries,
  largestBorderingCountry,
} from "./countries";
import { angularExtent, detectComponents, poleOfInaccessibility, type RawComponent } from "./detect";
import { applyInlandRise } from "./inlandElevation";
import { nameFeature } from "./name";
import { subdivideOcean } from "./ocean";
import { detectTerrainFeatures } from "./terrain";

export type { City, CityTier } from "./cities";
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
  population: number;
  areaKm2: number;
  anchor: Vec3; // where the (red) label sits
  extent: number; // angular radius (rad) for label sizing
};

/** Everything the label/country overlays need, computed once per (map, sea level, language). */
export type MapFeatures = {
  features: MapFeature[];
  countries: CountryInfo[];
  cities: City[]; // city markers — tier + zoom-gated, with interactive population popups
  borders: Float32Array; // flat [x0,y0,z0, x1,y1,z1, …] unit-sphere border segment pairs
  countryOf: Int32Array; // per cell: country index (matches CountryInfo.index), or -1 for ocean
  countryColors: Int32Array; // per country index: a 0–3 colour class for the choropleth fill (4-colouring)
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
  languagePool: Language[]
): MapFeatures {
  const adjacency = buildAdjacency(map);
  const components = detectComponents(map, seaLevel, adjacency);
  // Bake the continental inland rise into reportElevation (once per map) BEFORE countries/cities read it,
  // so a coast→interior elevation gradient feeds both city cards and the population lapse rate.
  applyInlandRise(map, seaLevel, adjacency, components);
  // Start a clean uniqueness namespace for this generation: countries claim names first, then cities,
  // then features (all via `namer`), so no two named things anywhere share a name. Resetting each call
  // keeps it deterministic — a fixed seed re-derives the same names instead of drifting across regens.
  namer.resetUniqueness();
  const countryData = assignCountries(
    map,
    seaLevel,
    adjacency,
    mapSeed,
    language,
    languagePool,
    namer
  );
  const { countryOf, countries } = countryData;
  const cities = assignCities(map, seaLevel, adjacency, countryOf, countries, mapSeed, namer);
  const countryColors = fourColorCountries(countryOf, adjacency, countries.length);

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
      population: c.population,
      areaKm2: c.areaKm2,
      anchor: siteVec(map, c.anchorCell),
      extent: c.extent,
    })),
    cities,
    borders: countryBorderSegments(map, countryOf),
    countryOf,
    countryColors,
  };
}
