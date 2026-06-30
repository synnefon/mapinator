import { describe, expect, it } from "vitest";
import type { Language } from "../../common/language";
import { OCEANS, snapshotParams, type MapSettings } from "../../common/settings";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency, coastDistance } from "./adjacency";
import { computeMapFeatures, type Settlement } from "./index";
import { EMPTY_RIVERS } from "./rivers";
import { minLevelForPopulation } from "./settlements";

// The big-city HEAD comes out of the ONE settlement engine (settlements.ts) scanned over the whole sphere at/
// above the global split, assembled into markers by cityStats.assembleHeadSettlements — exercised here end to
// end through computeMapFeatures (which builds the SettlementWorld + runs the head), exactly as the app does.

const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "city-test-seed";
const MAP_LANG: Language = "GREEK";
const POOL: Language[] = ["LATIN", "NORSE"];
const seaLevel = OCEANS.SEA_LEVEL.value;

const build = () => {
  const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
  const result = computeMapFeatures(map, seaLevel, MAP_LANG, SEED, new NameGenerator("c"), POOL, PARAMS, EMPTY_RIVERS);
  return { map, cities: result.cities, countries: result.countries };
};

describe("assembleHeadSettlements (the big-city head)", () => {
  it("places cities with a valid tier, population-keyed minLevel, and non-negative population", () => {
    const { countries, cities } = build();
    expect(cities.length).toBeGreaterThan(0);
    for (const c of cities) {
      expect(c.countryIndex).toBeGreaterThanOrEqual(0);
      expect(c.countryIndex).toBeLessThan(countries.length);
      expect(c.population).toBeGreaterThanOrEqual(0);
      expect(["big", "medium", "small"]).toContain(c.tier);
      // minLevel tracks population (the long tail surfaces on zoom); a capital is forced onto the globe.
      expect(c.minLevel).toBe(c.isCapital ? 1 : minLevelForPopulation(c.population));
    }
  });

  it("gives every country exactly one capital, tiered big (shows at zoom 1)", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      const caps = own.filter((c) => c.isCapital);
      expect(caps.length).toBe(1); // every country keeps a capital (synthesised if the scan missed it)
      expect(caps[0].tier).toBe("big");
      expect(caps[0].minLevel).toBe(1);
    }
  });

  it("makes the capital its country's LARGEST settlement", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      const capital = own.find((c) => c.isCapital)!;
      const bigger = own.filter((c) => c.population > capital.population).length;
      expect(bigger).toBe(0); // the head promotes the largest in each country
    }
  });

  it("places cities disproportionately near the coast (the water bias)", () => {
    const { map, cities } = build();
    const adjacency = buildAdjacency(map);
    const coastDist = coastDistance(map, seaLevel, adjacency);
    const isCoastal = (d: number): boolean => d >= 0 && d <= 2;
    const cityCoastal = cities.filter((c) => isCoastal(coastDist[c.cell])).length;
    let landTotal = 0;
    let landCoastal = 0;
    for (let c = 0; c < map.cellCount; c++) {
      if (coastDist[c] < 0) continue; // water
      landTotal++;
      if (isCoastal(coastDist[c])) landCoastal++;
    }
    expect(cityCoastal / cities.length).toBeGreaterThan(landCoastal / landTotal);
  });

  it("is deterministic for a fixed seed (incl. industries, elevation, fun fact, country)", () => {
    const a = build().cities;
    const b = build().cities;
    const key = (c: Settlement) =>
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
