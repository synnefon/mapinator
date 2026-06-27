import { describe, expect, it } from "vitest";
import { OCEANS, snapshotParams, type MapSettings } from "../../common/settings";
import { MapGenerator } from "../MapGenerator";
import { buildAdjacency } from "./adjacency";
import { detectComponents } from "./detect";
import { inlandRisenElevation } from "./inlandElevation";

// Run against a REAL generated globe (same basis as integration.test.ts), so the rise sees true coasts.
const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "inland-rise-seed";
const seaLevel = OCEANS.SEA_LEVEL.value;

const build = () => {
  const map = new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
  const adjacency = buildAdjacency(map);
  const components = detectComponents(map, seaLevel, adjacency);
  return { map, adjacency, components };
};

describe("inlandRisenElevation", () => {
  it("is pure: returns a new array and never mutates the map's reportElevation", () => {
    const { map, adjacency, components } = build();
    const raw = Float32Array.from(map.reportElevation); // snapshot before the call
    const risen = inlandRisenElevation(map, seaLevel, adjacency, components);
    expect(risen).not.toBe(map.reportElevation); // a fresh array, not the map's field
    expect(map.reportElevation).toStrictEqual(raw); // the map's field is untouched
  });

  it("raises interiors above the coastline and never lowers a cell", () => {
    const { map, adjacency, components } = build();
    const raw = Float32Array.from(map.reportElevation);
    const risen = inlandRisenElevation(map, seaLevel, adjacency, components);

    let anyRaised = false;
    for (let i = 0; i < map.cellCount; i++) {
      expect(risen[i]).toBeGreaterThanOrEqual(raw[i]); // the rise only ever adds
      if (risen[i] > raw[i] + 1e-6) anyRaised = true;
    }
    expect(anyRaised).toBe(true); // a real continent has interior cells lifted above its shore
  });

  it("is deterministic — re-running yields an identical field (no hidden once-per-map state)", () => {
    const { map, adjacency, components } = build();
    const a = inlandRisenElevation(map, seaLevel, adjacency, components);
    const b = inlandRisenElevation(map, seaLevel, adjacency, components);
    expect(b).toStrictEqual(a); // the old WeakSet guard would have made the 2nd call diverge
  });

  it("a waterless world (no water components) returns the report elevation unchanged", () => {
    const { map, adjacency } = build();
    const raw = Float32Array.from(map.reportElevation);
    const risen = inlandRisenElevation(map, seaLevel, adjacency, []); // no coast to rise from
    expect(risen).toStrictEqual(raw);
  });
});
