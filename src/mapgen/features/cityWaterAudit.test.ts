import { describe, expect, it } from "vitest";
import type { Language } from "../../common/language";
import { OCEANS, RIVERS, snapshotParams, type MapSettings } from "../../common/settings";
import { buildCpuCalc } from "../gpu/cpuField";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { computeMapFeatures, type SettlementWaterKind } from "./index";
import { computeRivers, type RiverData, type RiverFieldSampler } from "./rivers";

// === Settlement–water audit ===
// Tallies each big-city HEAD settlement by the water it sits ON (waterKind — the same classification the
// flavour split keys on) and reports the sea / river / lake / interior split. With the unified engine, water
// affinity is EMERGENT (the population coast/river density bonus + the shore/river snap), not fixed bucket
// fractions — so the table below is the real signal; the assertions are loose sanity rails.
//
// Rivers are computed on the CPU here (the real routing fed by a CPU field sampler — the GPU path's twin) so
// the audit exercises river snapping without a GPU.

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

describe("settlement–water placement audit", () => {
  it("reports the sea / river / lake / interior split across several worlds", { timeout: 120_000 }, () => {
    const tally: Record<SettlementWaterKind, number> = { ocean: 0, river: 0, lake: 0, none: 0 };
    let total = 0;
    const perSeed: string[] = [];

    for (const seed of SEEDS) {
      const map = new MapGenerator(seed, PARAMS).generateMap(SETTINGS);
      const result = computeMapFeatures(map, seaLevel, MAP_LANG, seed, new NameGenerator("a"), POOL, PARAMS, riversFor(seed));
      const cities = result.cities;

      const seedTally: Record<SettlementWaterKind, number> = { ocean: 0, river: 0, lake: 0, none: 0 };
      for (const c of cities) {
        seedTally[c.waterKind]++;
        tally[c.waterKind]++;
        total++;
      }
      const n = cities.length || 1;
      const pct = (k: SettlementWaterKind) => `${((100 * seedTally[k]) / n).toFixed(0)}%`;
      perSeed.push(
        `  ${seed}: ${cities.length.toString().padStart(4)} cities | ` +
          `sea ${pct("ocean").padStart(4)}  river ${pct("river").padStart(4)}  lake ${pct("lake").padStart(4)}  interior ${pct("none").padStart(4)}`
      );
    }

    const pct = (k: SettlementWaterKind) => (100 * tally[k]) / total;
    const waterAccess = 100 - pct("none");
    console.log(
      [
        "",
        "════════════ settlement–water audit ════════════",
        ...perSeed,
        "  ───────────────────────────────────────",
        `  TOTAL: ${total} cities across ${SEEDS.length} worlds`,
        `    coastal (sea):  ${pct("ocean").toFixed(1)}%`,
        `    riverside:      ${pct("river").toFixed(1)}%`,
        `    lakeside:       ${pct("lake").toFixed(1)}%`,
        `    interior:       ${pct("none").toFixed(1)}%`,
        `    → any water:    ${waterAccess.toFixed(1)}%`,
        "═════════════════════════════════════════════════",
        "",
      ].join("\n")
    );

    // Loose sanity rails (the table above is the real signal). Water affinity is emergent now — the density
    // coast/river bonus pulls settlements toward water and the snap seats the on-water ones — so a healthy
    // share sit ON water, but the exact split is no longer a dialled fraction.
    expect(total).toBeGreaterThan(0);
    expect(waterAccess).toBeGreaterThan(25); // settlements still cluster on/near water
  });
});
