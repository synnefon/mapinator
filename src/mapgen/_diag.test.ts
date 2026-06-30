import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { MOISTURE, snapshotParams, type MapSettings } from "../common/settings";
import { terrainClassOf } from "../renderer/BiomeColor";
import { MapGenerator } from "./MapGenerator";

it("final color-family histogram (shipped dials)", () => {
  const params = snapshotParams();
  const settings: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
  const map = new MapGenerator("diag-seed", params).generateMap(settings);
  const rainfall = MOISTURE.RAINFALL.value;
  const counts: Record<string, number> = {};
  let land = 0;
  for (let i = 0; i < map.cellCount; i++) {
    const cls = terrainClassOf(map.elevation[i], map.moisture[i], rainfall);
    if (!cls) continue;
    land++;
    counts[cls.family] = (counts[cls.family] ?? 0) + 1;
  }
  const p = (f: string) => (((100 * (counts[f] ?? 0)) / land).toFixed(1) + "%").padStart(7);
  writeFileSync(
    "/tmp/diag.txt",
    `RA=${params.MOUNTAINS.RIDGE_AMPLITUDE} RW=${params.TECTONICS.RANGE_WIDTH}\n` +
      `LOW${p("LOW")} MED${p("MEDIUM")} HIGH${p("HIGH")} VHIGH${p("VERY_HIGH")}\n`
  );
});
