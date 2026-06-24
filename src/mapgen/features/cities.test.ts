import { describe, expect, it } from "vitest";
import type { Language } from "../../common/language";
import { CITY, OCEAN, snapshotParams, type MapSettings } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { assignCities, coastDistance } from "./cities";
import { assignCountries } from "./countries";

const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "city-test-seed";
const MAP_LANG: Language = "GREEK";
const POOL: Language[] = ["LATIN", "NORSE"];
const seaLevel = OCEAN.SEA_LEVEL.value;

const build = () => {
  const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
  const adjacency = buildAdjacency(map);
  const { countryOf, countries } = assignCountries(
    map, seaLevel, adjacency, SEED, MAP_LANG, POOL, new NameGenerator("c")
  );
  const cities = assignCities(map, seaLevel, adjacency, countryOf, countries, SEED, new NameGenerator("c"));
  return { map, adjacency, countries, cities };
};

// A city's anchor is an exact cell-site vector, so it maps back to its cell index for terrain lookups.
const keyOf = (v: { x: number; y: number; z: number }): string => `${v.x},${v.y},${v.z}`;
const cellLookup = (map: ReturnType<typeof build>["map"]): Map<string, number> => {
  const m = new Map<string, number>();
  for (let c = 0; c < map.cellCount; c++) {
    m.set(`${map.sites[3 * c]},${map.sites[3 * c + 1]},${map.sites[3 * c + 2]}`, c);
  }
  return m;
};

describe("assignCities", () => {
  it("places cities with a valid tier, minLevel, and non-negative population", () => {
    const { countries, cities } = build();
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(c.countryIndex).toBeGreaterThanOrEqual(0);
      expect(c.countryIndex).toBeLessThan(countries.length);
      expect(c.population).toBeGreaterThanOrEqual(0);
      expect(["big", "medium", "small"]).toContain(c.tier);
      expect(c.minLevel).toBe(c.tier === "big" ? 1 : c.tier === "medium" ? 2 : 3);
    }
  });

  it("gives every populated country exactly one capital, tiered big (shows at zoom 1)", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      const caps = own.filter((c) => c.isCapital);
      expect(caps.length).toBe(own.length > 0 ? 1 : 0); // a country with no habitable site gets no city
      if (caps.length) {
        expect(caps[0].tier).toBe("big");
        expect(caps[0].minLevel).toBe(1);
      }
    }
  });

  it("makes the capital one of its country's four largest cities", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      if (own.length === 0) continue;
      const capital = own.find((c) => c.isCapital)!;
      const bigger = own.filter((c) => c.population > capital.population).length;
      expect(bigger).toBeLessThanOrEqual(3); // capital ranks 1st–4th by size
    }
  });

  it("places cities disproportionately near the coast", () => {
    const { map, adjacency, cities } = build();
    const coastDist = coastDistance(map, seaLevel, adjacency);
    const cellOf = cellLookup(map);
    const isCoastal = (d: number): boolean => d >= 0 && d <= 2;
    let cityCoastal = 0;
    for (const city of cities) {
      if (isCoastal(coastDist[cellOf.get(keyOf(city.anchor))!])) cityCoastal++;
    }
    let landTotal = 0;
    let landCoastal = 0;
    for (let c = 0; c < map.cellCount; c++) {
      if (coastDist[c] < 0) continue; // water
      landTotal++;
      if (isCoastal(coastDist[c])) landCoastal++;
    }
    expect(cityCoastal / cities.length).toBeGreaterThan(landCoastal / landTotal);
  });

  it("keeps cities off high ground: none on VERY_HIGH, only small on HIGH", () => {
    const { map, cities } = build();
    const cellOf = cellLookup(map);
    for (const city of cities) {
      const cell = cellOf.get(keyOf(city.anchor))!;
      const family = terrainClassOf(map.elevation[cell], map.moisture[cell], map.rainfall)?.family;
      expect(family).not.toBe("VERY_HIGH");
      if (family === "HIGH") expect(city.population).toBeLessThan(20_000); // MEDIUM_POP — small cities only
    }
  });

  it("keeps each country's urban population near CITY.URBAN_FRACTION of its total", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      const urban = own.reduce((sum, c) => sum + c.population, 0);
      // Rank-size sums to the urban total; dropped sub-5k villages only reduce it, rounding adds < 1/city.
      expect(urban).toBeLessThanOrEqual(Math.round(CITY.URBAN_FRACTION.value * country.population) + own.length);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = build().cities;
    const b = build().cities;
    expect(a.map((c) => `${c.name}:${c.population}:${c.tier}:${c.isCapital}`)).toStrictEqual(
      b.map((c) => `${c.name}:${c.population}:${c.tier}:${c.isCapital}`)
    );
  });
});
