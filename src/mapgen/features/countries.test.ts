import { describe, expect, it } from "vitest";
import type { Language } from "../../common/language";
import { OCEANS, snapshotParams, type MapSettings } from "../../common/settings";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { assignCountries, colorCountries, largestBorderingCountry } from "./countries";

const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "country-validity-seed";
const MAP_LANG: Language = "GREEK";
const POOL: Language[] = ["LATIN", "NORSE", "TAMIL", "RUSSIAN"]; // deliberately excludes the map language
const seaLevel = OCEANS.SEA_LEVEL.value;
const buildMap = () => new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
const assign = (map: ReturnType<typeof buildMap>) =>
  assignCountries(map, map.reportElevation, seaLevel, buildAdjacency(map), SEED, MAP_LANG, POOL, new NameGenerator("c"));

describe("assignCountries", () => {
  it("assigns every land cell to a country and leaves ocean cells country-less", () => {
    const map = buildMap();
    const { countryOf, countries } = assign(map);
    expect(countries.length).toBeGreaterThan(0);
    for (let i = 0; i < map.cellCount; i++) {
      if (map.elevation[i] >= seaLevel) {
        expect(countryOf[i]).toBeGreaterThanOrEqual(0);
        expect(countryOf[i]).toBeLessThan(countries.length);
      } else {
        expect(countryOf[i]).toBe(-1);
      }
    }
  });

  it("guarantees at least one country shares the map's language (pool excludes it)", () => {
    const { countries } = assign(buildMap());
    expect(countries.some((c) => c.language === MAP_LANG)).toBe(true);
  });

  it("is deterministic for a fixed seed", () => {
    const map = buildMap();
    const a = assign(map);
    const b = assign(map);
    expect(Array.from(a.countryOf)).toStrictEqual(Array.from(b.countryOf));
    expect(a.countries.map((c) => `${c.language}:${c.name}`)).toStrictEqual(
      b.countries.map((c) => `${c.language}:${c.name}`)
    );
  });

  it("anchors each country on its own land", () => {
    const map = buildMap();
    const { countryOf, countries } = assign(map);
    for (let ci = 0; ci < countries.length; ci++) {
      expect(countryOf[countries[ci].anchorCell]).toBe(ci); // label sits inside the country
    }
  });
});

describe("largestBorderingCountry", () => {
  it("returns a valid country for a coastal water cell", () => {
    const map = buildMap();
    const adjacency = buildAdjacency(map);
    const data = assignCountries(map, map.reportElevation, seaLevel, adjacency, SEED, MAP_LANG, POOL, new NameGenerator("c"));
    // a water cell adjacent to land (a coast) must resolve to some bordering country
    let coastWater = -1;
    for (let i = 0; i < map.cellCount && coastWater < 0; i++) {
      if (map.elevation[i] >= seaLevel) continue;
      if (adjacency[i].some((n) => data.countryOf[n] >= 0)) coastWater = i;
    }
    expect(coastWater).toBeGreaterThanOrEqual(0);
    const ci = largestBorderingCountry(coastWater, map, seaLevel, adjacency, data);
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(ci).toBeLessThan(data.countries.length);
  });
});

describe("colorCountries", () => {
  it("assigns each country a class 0–5 and colours bordering countries apart", () => {
    const map = buildMap();
    const adjacency = buildAdjacency(map);
    const { countryOf, countries } = assign(map);
    const colors = colorCountries(countryOf, adjacency, countries.length);
    expect(colors.length).toBe(countries.length);
    for (const cls of colors) {
      expect(cls).toBeGreaterThanOrEqual(0);
      expect(cls).toBeLessThanOrEqual(5);
    }
    // Greedy degree-ordered colouring is proper on these planar maps: no two bordering countries share
    // a class (a rare overflow would fall back to 0; this guards that it doesn't bite in practice).
    let conflicts = 0;
    for (let i = 0; i < map.cellCount; i++) {
      const a = countryOf[i];
      if (a < 0) continue;
      for (const nb of adjacency[i]) {
        const b = countryOf[nb];
        if (b >= 0 && b !== a && colors[a] === colors[b]) conflicts++;
      }
    }
    expect(conflicts).toBe(0);
  });
});
