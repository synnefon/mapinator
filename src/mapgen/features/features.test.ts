import { describe, expect, it } from "vitest";
import type { GlobeMap } from "../../common/map";
import { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";
import { classifyMinor } from "./classify";
import { detectComponents, type RawComponent } from "./detect";
import { nameFeature } from "./name";

// Minimal GlobeMap for the graph helpers: they only read cellCount, sites, ringOffsets, ringVerts,
// and elevation. The rest are filled empty so the object is a real GlobeMap (no casts).
function testMap(parts: {
  cellCount: number;
  sites: number[];
  ringOffsets: number[];
  ringVerts: number[];
  elevation: number[];
}): GlobeMap {
  const { cellCount } = parts;
  const empty = new Float32Array(0);
  return {
    cellCount,
    sites: new Float32Array(parts.sites),
    ringOffsets: new Uint32Array(parts.ringOffsets),
    ringVerts: new Float32Array(parts.ringVerts),
    elevation: new Float32Array(parts.elevation),
    moisture: new Float32Array(cellCount),
    ice: new Float32Array(cellCount),
    shade: new Float32Array(cellCount),
    plate: new Uint16Array(cellCount),
    arrowPositions: empty,
    arrowDirections: empty,
    rainfall: 0.5,
    pointCount: cellCount,
    maxRingRadius: 0,
  };
}

// Three square cells in a row. Cell 0 and 1 share an EDGE (two corners); cell 0 and 2 share only a
// single corner (touch at a point); cell 1 and 2 share nothing.
const THREE_CELLS = {
  cellCount: 3,
  ringOffsets: [0, 4, 8, 12],
  // prettier-ignore
  ringVerts: [
    0, 0, 0,  1, 0, 0,  1, 1, 0,  0, 1, 0,   // cell 0: (0,0)-(1,0)-(1,1)-(0,1)
    1, 0, 0,  2, 0, 0,  2, 1, 0,  1, 1, 0,   // cell 1: shares edge (1,0)-(1,1) with cell 0
    0, 1, 0, -1, 1, 0, -1, 2, 0,  0, 2, 0,   // cell 2: shares only corner (0,1) with cell 0
  ],
  sites: [0.5, 0.5, 0, 1.5, 0.5, 0, -0.5, 1.5, 0],
};

describe("buildAdjacency", () => {
  it("links cells sharing an edge, not cells sharing a single corner", () => {
    const adj = buildAdjacency(testMap({ ...THREE_CELLS, elevation: [0, 0, 0] }));
    expect(adj[0]).toContain(1); // shared edge → neighbours
    expect(adj[1]).toContain(0);
    expect(adj[0]).not.toContain(2); // single shared corner → not adjacent
    expect(adj[2]).toStrictEqual([]);
  });
});

describe("detectComponents", () => {
  it("groups same-class cells across adjacency and splits at the waterline", () => {
    // cells 0,1 are land (>= sea level), cell 2 is water (< sea level); 0-1 are edge neighbours.
    const map = testMap({ ...THREE_CELLS, elevation: [1, 1, 0] });
    const comps = detectComponents(map, 0.5, buildAdjacency(map));

    expect(comps).toHaveLength(2);
    const land = comps.find((c) => c.cls === "land");
    const water = comps.find((c) => c.cls === "water");
    expect([...(land?.cells ?? [])].sort((a, b) => a - b)).toStrictEqual([0, 1]); // cells 0 + 1 merged
    expect(water?.cells).toStrictEqual([2]); // cell 2 alone
  });
});

describe("classifyMinor", () => {
  const comp = (cls: "water" | "land", cells: number[]): RawComponent => ({ cls, cells });
  // n cells starting at index 10 (so repCell is well-defined and non-zero).
  const run = (cls: "water" | "land", n: number, total: number) =>
    classifyMinor(comp(cls, Array.from({ length: n }, (_, i) => i + 10)), total);

  it("classifies lakes + land by size, assigns reveal tiers, and drops specks", () => {
    const total = 10000; // MIN=6, LARGE_MINOR≥80, CONTINENT≥400
    expect(run("water", 100, total)).toMatchObject({ kind: "LAKE", minLevel: 1 }); // large lake
    expect(run("water", 50, total)).toMatchObject({ kind: "LAKE", minLevel: 2 }); // small lake
    expect(run("land", 1500, total)).toMatchObject({ kind: "CONTINENT", minLevel: 0 });
    expect(run("land", 90, total)).toMatchObject({ kind: "ISLAND", minLevel: 1 }); // large island
    expect(run("land", 20, total)).toMatchObject({ kind: "ISLAND", minLevel: 2 }); // small island
    expect(run("water", 3, total)).toBeNull(); // below the noise floor → skipped
  });

  it("seeds the name from the smallest member index (repCell)", () => {
    expect(classifyMinor(comp("land", [42, 7, 99]), 100)?.repCell).toBe(7);
  });
});

describe("nameFeature", () => {
  it("is deterministic in (seed, kind, repCell) and carries the descriptor", () => {
    const namer = new NameGenerator("ignored"); // generate() reseeds per call from the feature seed
    const a = nameFeature("SEA", "MYSEED", 42, "GREEK", namer);
    const b = nameFeature("SEA", "MYSEED", 42, "GREEK", namer);
    expect(a).toBe(b);
    expect(a).toMatch(/sea/i);
    expect(nameFeature("LAKE", "MYSEED", 42, "GREEK", namer)).toMatch(/lake/i);
    expect(nameFeature("ISLAND", "MYSEED", 7, "GREEK", namer)).toMatch(/is(land|le)/i);
  });
});
