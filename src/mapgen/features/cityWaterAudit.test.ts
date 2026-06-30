import { describe, expect, it } from "vitest";
import type { Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import { OCEANS, RIVERS, snapshotParams, type MapSettings } from "../../common/settings";
import { buildCpuCalc } from "../gpu/cpuField";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { assignCities, type CityWaterKind } from "./cities";
import { assignCountries } from "./countries";
import { computeRivers, type RiverData, type RiverFieldSampler } from "./rivers";

// === City–water audit ===
// Tallies each placed city by the water it sits ON (City.waterKind — the same classification that drives the
// flavour split + the debug marker tint) and reports the sea / river / lake / interior split, so the bucket
// proportions (CITY.RIVER_FRACTION / SEA_FRACTION / LAKE_FRACTION) can be judged against the record: premodern
// cities sat overwhelmingly on water, and RIVERS were the most common, the coast a major second, with an
// interior minority. Run it to SEE the numbers (it logs a table); the assertions are loose sanity rails.
//
// Rivers are computed on the CPU here (the real routing fed by a CPU field sampler — the GPU path's twin) so
// the audit exercises the river bucket without a GPU.

const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const MAP_LANG: Language = "GREEK";
const POOL: Language[] = ["LATIN", "NORSE", "TAMIL"];
const seaLevel = OCEANS.SEA_LEVEL.value;
const SEEDS = ["audit-a", "audit-b", "audit-c", "audit-d"];

/** The drawn river network for a seed, routed on the CPU (mirrors main.ts's GPU-sampled call). */
function riversFor(seed: string): RiverData {
  const { calc } = buildCpuCalc(seed, PARAMS);
  const sampler: RiverFieldSampler = (sites) => {
    const m = sites.length / 3;
    const elevation = new Float32Array(m);
    const reportElevation = new Float32Array(m);
    const moisture = new Float32Array(m);
    const ice = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const c = calc.sampleCell({ x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });
      elevation[i] = c.elevation;
      reportElevation[i] = c.reportElevation;
      moisture[i] = c.moisture;
      ice[i] = c.ice;
    }
    return { elevation, reportElevation, moisture, ice };
  };
  return computeRivers(sampler, {
    seaLevel,
    minDrainage: RIVERS.MIN_DRAINAGE.value,
    moistureWeight: RIVERS.MOISTURE_WEIGHT.value,
    sourceMoisture: RIVERS.SOURCE_MOISTURE.value,
    waterScaling: RIVERS.WATER_SCALING.value,
    branching: RIVERS.BRANCHING.value,
    meander: RIVERS.MEANDER.value,
    meanderDetail: RIVERS.MEANDER_DETAIL.value,
  });
}

describe("city–water placement audit", () => {
  it("reports the sea / river / lake / interior split across several worlds", { timeout: 120_000 }, () => {
    const tally: Record<CityWaterKind, number> = { ocean: 0, river: 0, lake: 0, none: 0 };
    let total = 0;
    const perSeed: string[] = [];

    for (const seed of SEEDS) {
      const map = new MapGenerator(seed, PARAMS).generateMap(SETTINGS);
      const adjacency = buildAdjacency(map);
      const { calc } = buildCpuCalc(seed, PARAMS);
      const fineLandAt = (p: Vec3): boolean => calc.sampleCell(p).elevation >= seaLevel;
      const { countryOf, countries } = assignCountries(map, map.reportElevation, seaLevel, adjacency, seed, MAP_LANG, POOL, new NameGenerator("a"));
      const cities = assignCities(map, map.reportElevation, seaLevel, adjacency, countryOf, countries, seed, new NameGenerator("a"), fineLandAt, riversFor(seed));

      const seedTally: Record<CityWaterKind, number> = { ocean: 0, river: 0, lake: 0, none: 0 };
      for (const c of cities) {
        seedTally[c.waterKind]++;
        tally[c.waterKind]++;
        total++;
      }
      const n = cities.length || 1;
      const pct = (k: CityWaterKind) => `${((100 * seedTally[k]) / n).toFixed(0)}%`;
      perSeed.push(
        `  ${seed}: ${cities.length.toString().padStart(4)} cities | ` +
          `sea ${pct("ocean").padStart(4)}  river ${pct("river").padStart(4)}  lake ${pct("lake").padStart(4)}  interior ${pct("none").padStart(4)}`
      );
    }

    const pct = (k: CityWaterKind) => (100 * tally[k]) / total;
    const waterAccess = 100 - pct("none");
    console.log(
      [
        "",
        "════════════ city–water audit ════════════",
        ...perSeed,
        "  ───────────────────────────────────────",
        `  TOTAL: ${total} cities across ${SEEDS.length} worlds`,
        `    coastal (sea):  ${pct("ocean").toFixed(1)}%`,
        `    riverside:      ${pct("river").toFixed(1)}%`,
        `    lakeside:       ${pct("lake").toFixed(1)}%`,
        `    interior:       ${pct("none").toFixed(1)}%`,
        `    → any water:    ${waterAccess.toFixed(1)}%`,
        "═══════════════════════════════════════════",
        "",
      ].join("\n")
    );

    // Loose sanity rails (the table above is the real signal). Biggest cities are placed first and claim the
    // prime water, so they sit overwhelmingly on it; with a dense enough river network the small-town tail
    // finds water too, so the aggregate lands near the 1400 record — most on water, rivers a leading water.
    expect(total).toBeGreaterThan(0);
    expect(waterAccess).toBeGreaterThan(55); // premodern settlements sat mostly on water
    expect(pct("river")).toBeGreaterThan(20); // rivers are a leading settlement water
  });
});
