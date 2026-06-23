import { describe, expect, it } from "vitest";
import { OCEAN, snapshotParams, type MapSettings } from "../../common/settings";
import { MapGenerator } from "../MapGenerator";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { detectComponents } from "./detect";
import { computeMapFeatures, type MapFeature } from "./index";

// Validity checks against a REAL generated globe (not synthetic fixtures): the feature pipeline runs
// end to end and must hold these invariants.
const PARAMS = snapshotParams();
const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };
const SEED = "feature-validity-seed";
const buildMap = () => new MapGenerator(SEED, PARAMS).generateMap(SETTINGS);
const seaLevel = OCEAN.SEA_LEVEL.value;
const isWaterKind = (k: MapFeature["kind"]) => k === "OCEAN" || k === "SEA" || k === "LAKE";

// Nearest cell to a point on the sphere (an anchor is a member site, so this recovers that cell).
function nearestCell(map: ReturnType<typeof buildMap>, p: { x: number; y: number; z: number }): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < map.cellCount; i++) {
    const dot = p.x * map.sites[3 * i] + p.y * map.sites[3 * i + 1] + p.z * map.sites[3 * i + 2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best;
}

describe("feature pipeline on a real globe", () => {
  it("builds a healthy adjacency graph (symmetric, no isolated cells, Goldberg degree)", () => {
    const map = buildMap();
    const adj = buildAdjacency(map);
    let isolated = 0;
    let asym = 0;
    let degMin = Infinity;
    let degMax = 0;
    for (let i = 0; i < map.cellCount; i++) {
      const d = adj[i].length;
      if (d === 0) isolated++;
      degMin = Math.min(degMin, d);
      degMax = Math.max(degMax, d);
      for (const n of adj[i]) if (!adj[n].includes(i)) asym++;
    }
    expect(isolated).toBe(0);
    expect(asym).toBe(0);
    expect(degMin).toBeGreaterThanOrEqual(5); // Goldberg: 12 pentagons (deg 5), the rest hexagons (deg 6)
    expect(degMax).toBeLessThanOrEqual(6);
  });

  it("keeps the world ocean unified (one dominant connected water body)", () => {
    const map = buildMap();
    const water = detectComponents(map, seaLevel, buildAdjacency(map))
      .filter((c) => c.cls === "water")
      .sort((a, b) => b.cells.length - a.cells.length);
    const totalWater = water.reduce((s, c) => s + c.cells.length, 0);
    expect(water[0].cells.length / totalWater).toBeGreaterThan(0.5); // not shattered into pieces
  });

  it("gives the connected ocean several names (open oceans + marginal seas)", () => {
    const map = buildMap();
    const features = computeMapFeatures(map, seaLevel, "GREEK", SEED, new NameGenerator("f"));
    const oceanic = features.filter((f) => f.kind === "OCEAN" || f.kind === "SEA");
    expect(oceanic.length).toBeGreaterThanOrEqual(2); // multiple labels across the one water body
    expect(features.some((f) => f.kind === "OCEAN")).toBe(true);
  });

  it("labels sizable land terrain (mountains / deserts / forests) at tier 1+", () => {
    const map = buildMap();
    const features = computeMapFeatures(map, seaLevel, "GREEK", SEED, new NameGenerator("f"));
    const terrain = features.filter(
      (f) => f.kind === "MOUNTAINS" || f.kind === "DESERT" || f.kind === "FOREST"
    );
    expect(terrain.length).toBeGreaterThan(0); // the validity seed has substantial terrain
    for (const t of terrain) expect(t.minLevel).toBeGreaterThanOrEqual(1); // never on the globe view
  });

  it("anchors each feature on terrain of its own kind (the lake-on-a-mountain bug)", () => {
    const map = buildMap();
    const features = computeMapFeatures(map, seaLevel, "GREEK", SEED, new NameGenerator("f"));
    for (const f of features) {
      const anchorIsWater = map.elevation[nearestCell(map, f.anchor)] < seaLevel;
      expect(anchorIsWater).toBe(isWaterKind(f.kind)); // water labels sit in water, land on land
    }
  });

  it("names every feature, deterministically", () => {
    const map = buildMap();
    const a = computeMapFeatures(map, seaLevel, "GREEK", SEED, new NameGenerator("f"));
    const b = computeMapFeatures(map, seaLevel, "GREEK", SEED, new NameGenerator("f"));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((f) => f.name.trim().length > 0)).toBe(true);
    expect(a.map((f) => `${f.kind}:${f.name}`)).toStrictEqual(b.map((f) => `${f.kind}:${f.name}`));
  });
});
