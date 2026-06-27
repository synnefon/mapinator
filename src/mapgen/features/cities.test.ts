import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import { OCEANS, POPULATION, snapshotParams, type MapSettings } from "../../common/settings";
import { terrainClassOf } from "../../renderer/BiomeColor";
import { buildCpuCalc } from "../gpu/cpuField";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency, coastDistance } from "./adjacency";
import { assignCities, habitabilityWeight, HABITABILITY_FLOOR, type City } from "./cities";
import { assignCountries } from "./countries";
import { EMPTY_RIVERS, type RiverData } from "./rivers";

const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "city-test-seed";
const MAP_LANG: Language = "GREEK";
const POOL: Language[] = ["LATIN", "NORSE"];
const seaLevel = OCEANS.SEA_LEVEL.value;
// The same fine field the renderer draws, re-derived from the test's seed/params (seed+params are fixed,
// so one calc serves every build) — lets coastal markers snap to the rendered waterline.
const { calc } = buildCpuCalc(SEED, PARAMS);
const fineLandAt = (p: Vec3): boolean => calc.sampleCell(p).elevation >= seaLevel;

const build = () => {
  const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
  const adjacency = buildAdjacency(map);
  const { countryOf, countries } = assignCountries(
    map, map.reportElevation, seaLevel, adjacency, SEED, MAP_LANG, POOL, new NameGenerator("c")
  );
  const cities = assignCities(map, map.reportElevation, seaLevel, adjacency, countryOf, countries, SEED, new NameGenerator("c"), fineLandAt, EMPTY_RIVERS);
  return { map, adjacency, countryOf, countries, cities };
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

  it("keeps each country's urban population near POPULATION.URBAN_FRACTION of its total", () => {
    const { countries, cities } = build();
    for (const country of countries) {
      const own = cities.filter((c) => c.countryIndex === country.index);
      const urban = own.reduce((sum, c) => sum + c.population, 0);
      // Rank-size sums to the urban total; dropped sub-5k villages only reduce it, rounding adds < 1/city.
      expect(urban).toBeLessThanOrEqual(Math.round(POPULATION.URBAN_FRACTION.value * country.population) + own.length);
    }
  });

  it("dialing up urban fraction yields more (and larger) cities", () => {
    // Map + countries are independent of POPULATION.URBAN_FRACTION (cities read the live dial), so build once.
    const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    const adjacency = buildAdjacency(map);
    const { countryOf, countries } = assignCountries(
      map, map.reportElevation, seaLevel, adjacency, SEED, MAP_LANG, POOL, new NameGenerator("c")
    );
    const at = (frac: number) => {
      const prev = POPULATION.URBAN_FRACTION.value;
      POPULATION.URBAN_FRACTION.value = frac;
      try {
        const cities = assignCities(map, map.reportElevation, seaLevel, adjacency, countryOf, countries, SEED, new NameGenerator("c"), fineLandAt, EMPTY_RIVERS);
        return { count: cities.length, urban: cities.reduce((s, c) => s + c.population, 0) };
      } finally {
        POPULATION.URBAN_FRACTION.value = prev;
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

  it("pulls a non-coastal city onto a nearby large river (bank snap)", () => {
    const { map, adjacency, countryOf, countries, cities } = build();
    const coastDist = coastDistance(map, seaLevel, adjacency);
    // The most-inland city: ≥2 hops from any water cell, so neither sea nor lake shore can claim its
    // marker — only a river can move it. (Guard that this map actually has an interior city to exercise.)
    const target = cities.reduce((a, b) => (coastDist[b.cell] > coastDist[a.cell] ? b : a));
    expect(coastDist[target.cell]).toBeGreaterThan(1);
    const center: Vec3 = { x: map.sites[3 * target.cell], y: map.sites[3 * target.cell + 1], z: map.sites[3 * target.cell + 2] };
    // A full-strength (large) river vertex ~half a cell off the centre: inside SNAP, but clearly off-centre,
    // so a successful snap is observable as the marker MOVING onto it.
    const cellSpacing = Math.sqrt((4 * Math.PI) / map.cellCount);
    const bank = Vec3.normalize({ x: center.x + 0.5 * cellSpacing, y: center.y, z: center.z });
    const river: RiverData = {
      positions: Float32Array.from([bank.x, bank.y, bank.z, bank.x, bank.y, bank.z]),
      widths: Float32Array.from([1, 1]),
      offsets: Uint32Array.from([0, 2]),
      labels: [],
    };
    const moved = assignCities(map, map.reportElevation, seaLevel, adjacency, countryOf, countries, SEED, new NameGenerator("c"), fineLandAt, river)
      .find((c) => c.cell === target.cell)!;
    const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(dist(target.anchor, center)).toBeLessThan(1e-6); // EMPTY rivers → sat at the cell centre
    expect(dist(moved.anchor, bank)).toBeLessThan(1e-6); // with the river → snapped onto the bank point
    expect(dist(moved.anchor, center)).toBeGreaterThan(1e-3); // … which is genuinely off-centre
  });
});

describe("habitabilityWeight (cities avoid deserts + ice)", () => {
  it("leaves well-watered, ice-free land at full weight regardless of aversion", () => {
    expect(habitabilityWeight(0.9, 0, 0, 1, 1)).toBe(1);
  });

  it("penalises dry land far from water, scaled by desert aversion", () => {
    expect(habitabilityWeight(0.0, 0, 0, 0, 0)).toBe(1); // aversion 0 → no penalty even bone dry
    const mild = habitabilityWeight(0.0, 0, 0, 0.5, 0);
    const full = habitabilityWeight(0.0, 0, 0, 1, 0);
    expect(mild).toBeLessThan(1);
    expect(full).toBeLessThan(mild); // stronger aversion → harsher penalty
  });

  it("waives the dryness penalty near water — desert coasts, riverbanks + oases settle freely", () => {
    expect(habitabilityWeight(0.0, 0, 1, 1, 0)).toBe(1); // bone dry but ON water → no penalty
    const inland = habitabilityWeight(0.0, 0, 0, 1, 0);
    const halfway = habitabilityWeight(0.0, 0, 0.5, 1, 0);
    expect(halfway).toBeGreaterThan(inland); // nearer water ⇒ less penalised
  });

  it("penalises iced land everywhere (even on a coast), scaled by ice aversion", () => {
    expect(habitabilityWeight(0.9, 1, 0, 0, 0)).toBe(1); // ice aversion 0 → no penalty
    expect(habitabilityWeight(0.9, 1, 0, 0, 1)).toBeLessThan(1); // inland ice → penalised
    expect(habitabilityWeight(0.9, 1, 1, 0, 1)).toBeLessThan(1); // ON water → ice STILL penalises (unlike dryness)
  });

  it("never drops below the floor — the worst land is rare, not impossible", () => {
    const worst = habitabilityWeight(0.0, 1, 0, 1, 1); // bone dry, fully iced, far from water, max aversion
    expect(worst).toBeGreaterThanOrEqual(HABITABILITY_FLOOR);
    expect(worst).toBeGreaterThan(0); // a city here stays POSSIBLE
  });
});
