import { describe, expect, it } from "vitest";
import { type MapSettings, snapshotParams, TECTONIC } from "../common/settings";
import { MapGenerator } from "./MapGenerator";

const SETTINGS: MapSettings = { resolution: 0, zoom: 0, theme: "lush" };
const SEED = "characterization-seed";
const PARAMS = snapshotParams();

describe("MapGenerator.generateMap", () => {
  it("is deterministic for a fixed seed", () => {
    const a = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    const b = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    expect(Array.from(a.elevation)).toStrictEqual(Array.from(b.elevation));
    expect(Array.from(a.moisture)).toStrictEqual(Array.from(b.moisture));
    expect(Array.from(a.ice)).toStrictEqual(Array.from(b.ice));
    expect(Array.from(a.plate)).toStrictEqual(Array.from(b.plate));
  });

  it("keeps every per-cell field within its documented range", () => {
    const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    const plateCap = Math.max(2, Math.round(TECTONIC.PLATE_COUNT.value));
    for (let i = 0; i < map.cellCount; i++) {
      expect(map.elevation[i]).toBeGreaterThanOrEqual(0);
      expect(map.elevation[i]).toBeLessThanOrEqual(1);
      expect(map.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(map.moisture[i]).toBeLessThanOrEqual(1);
      expect(map.ice[i]).toBeGreaterThanOrEqual(0);
      expect(map.ice[i]).toBeLessThanOrEqual(1);
      expect(map.plate[i]).toBeLessThan(plateCap);
    }
  });

  it("packs a structurally consistent mesh", () => {
    const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
    expect(map.cellCount).toBeGreaterThan(0);
    expect(map.sites.length).toBe(map.cellCount * 3);
    expect(map.elevation.length).toBe(map.cellCount);
    expect(map.ringOffsets.length).toBe(map.cellCount + 1);
    // ringOffsets is a non-decreasing prefix sum ending at the total vertex count.
    expect(map.ringOffsets[0]).toBe(0);
    for (let i = 0; i < map.cellCount; i++) {
      expect(map.ringOffsets[i + 1]).toBeGreaterThanOrEqual(map.ringOffsets[i]);
    }
    expect(map.ringOffsets[map.cellCount]).toBe(map.ringVerts.length / 3);
  });
});
