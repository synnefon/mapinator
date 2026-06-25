import { describe, expect, it } from "vitest";
import type { Language } from "../../common/language";
import { CITY, OCEAN, snapshotParams, type MapSettings } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { assignCities, coastDistance, type City } from "./cities";
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
    const isCoastal = (d: number): boolean => d >= 0 && d <= 2;
    let cityCoastal = 0;
    for (const city of cities) {
      if (isCoastal(coastDist[city.cell])) cityCoastal++;
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
    for (const city of cities) {
      const cell = city.cell;
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

  it("dialing up urban fraction yields more (and larger) cities", () => {
    // Map + countries are independent of CITY.URBAN_FRACTION (cities read the live dial), so build once.
    const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    const adjacency = buildAdjacency(map);
    const { countryOf, countries } = assignCountries(
      map, seaLevel, adjacency, SEED, MAP_LANG, POOL, new NameGenerator("c")
    );
    const at = (frac: number) => {
      const prev = CITY.URBAN_FRACTION.value;
      CITY.URBAN_FRACTION.value = frac;
      try {
        const cities = assignCities(map, seaLevel, adjacency, countryOf, countries, SEED, new NameGenerator("c"));
        return { count: cities.length, urban: cities.reduce((s, c) => s + c.population, 0) };
      } finally {
        CITY.URBAN_FRACTION.value = prev;
      }
    };
    const low = at(0.05);
    const high = at(0.4);
    expect(high.count).toBeGreaterThan(low.count); // more cities
    expect(high.urban).toBeGreaterThan(low.urban); // and a larger total urban population
  });

  it("is deterministic for a fixed seed (incl. industries, elevation, fun fact, country)", () => {
    const a = build().cities;
    const b = build().cities;
    const key = (c: City) =>
      [c.name, c.population, c.tier, c.isCapital, c.countryName, c.elevationMeters, c.industries.join("/"), c.funFact].join(":");
    expect(a.map(key)).toStrictEqual(b.map(key));
  });

  it("attaches well-formed stats: 1–3 industries, non-negative elevation, a fun fact, its country", () => {
    const { countries, cities } = build();
    for (const c of cities) {
      expect(c.industries.length).toBeGreaterThanOrEqual(1);
      expect(c.industries.length).toBeLessThanOrEqual(3);
      expect(c.elevationMeters).toBeGreaterThanOrEqual(0);
      expect(c.funFact.trim().length).toBeGreaterThan(0);
      expect(c.countryName).toBe(countries[c.countryIndex].name);
    }
  });
});
