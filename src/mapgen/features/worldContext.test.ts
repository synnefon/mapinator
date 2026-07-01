import { describe, expect, it } from "vitest";
import type { GlobeMap } from "../../common/map";
import { snapshotParams } from "../../common/settings";
import { EMPTY_RIVERS } from "./rivers";
import { buildWorldContext } from "./worldContext";

// The point of buildWorldContext: the feature pipeline's wiring is exercisable from a HAND-BUILT
// map (the features.test.ts fixture discipline) — no globe generation, no worker, milliseconds.

// A row of `n` unit-square cells, each sharing an edge with the next. Cell 0 is water, the rest
// land — so distances-to-water grow left to right and every helper has a knowable answer.
function rowMap(n: number, elevation: number[]): GlobeMap {
  const sites: number[] = [];
  const ringOffsets: number[] = [0];
  const ringVerts: number[] = [];
  for (let i = 0; i < n; i++) {
    sites.push(i + 0.5, 0.5, 0);
    ringVerts.push(i, 0, 0, i + 1, 0, 0, i + 1, 1, 0, i, 1, 0);
    ringOffsets.push(4 * (i + 1));
  }
  const empty = new Float32Array(0);
  return {
    cellCount: n,
    sites: new Float32Array(sites),
    ringOffsets: new Uint32Array(ringOffsets),
    ringVerts: new Float32Array(ringVerts),
    elevation: new Float32Array(elevation),
    reportElevation: new Float32Array(n),
    moisture: new Float32Array(n),
    ice: new Float32Array(n),
    koppenZone: new Float32Array(n),
    shade: new Float32Array(n),
    plate: new Uint16Array(n),
    arrowPositions: empty,
    arrowDirections: empty,
    rainfall: 0.5,
    pointCount: n,
    maxRingRadius: 0,
  };
}

const SEA = 0.5;
const N = 6;
const map = rowMap(N, [0.2, 1, 1, 1, 1, 1]); // cell 0 is the sea; 1..5 land, deeper inland by index
const ctx = buildWorldContext(map, SEA, "world-ctx-seed", snapshotParams(), EMPTY_RIVERS);

describe("buildWorldContext", () => {
  it("links the row into a chain and splits it into one sea + one landmass", () => {
    expect(ctx.adjacency[0]).toStrictEqual([1]);
    expect(ctx.adjacency[2].sort((a, b) => a - b)).toStrictEqual([1, 3]);
    const land = ctx.components.find((c) => c.cls === "land");
    const water = ctx.components.find((c) => c.cls === "water");
    expect([...(land?.cells ?? [])].sort((a, b) => a - b)).toStrictEqual([1, 2, 3, 4, 5]);
    expect(water?.cells).toStrictEqual([0]);
    expect(ctx.largeWater[0]).toBe(1); // the biggest water body always counts as sea
  });

  it("water distances grow with hops inland; water cells stay -1", () => {
    expect(ctx.coastDist[0]).toBe(-1);
    expect(Array.from(ctx.coastDist.slice(1))).toStrictEqual([0, 1, 2, 3, 4]);
    expect(Array.from(ctx.seaDist)).toStrictEqual(Array.from(ctx.coastDist)); // the one water body IS the sea
  });

  it("the inland rise is 0 on the shore and grows monotonically into the interior", () => {
    expect(ctx.reportElevation[0]).toBe(0); // water untouched
    expect(ctx.reportElevation[1]).toBe(0); // shore cell (0 hops) — no rise
    for (let i = 2; i <= 5; i++) {
      expect(ctx.reportElevation[i]).toBeGreaterThan(ctx.reportElevation[i - 1]);
    }
  });

  it("the shore direction points from the first land cell toward the water", () => {
    expect(ctx.coastDir[3 * 1]).toBe(-1); // cell 1 → cell 0 is straight -x
    expect(ctx.coastDir[3 * 1 + 1]).toBe(0);
    expect(ctx.coastDir[3 * 5]).toBe(0); // deep interior cell touches no water → zero vector
  });

  it("kd lookup lands on the nearest cell; empty rivers make no grid; spacing follows cell count", () => {
    expect(ctx.nearestCellAt({ x: 1.4, y: 0.5, z: 0 })).toBe(1);
    expect(ctx.nearestCellAt({ x: 4.9, y: 0.4, z: 0 })).toBe(4);
    expect(ctx.riverGrid).toBeNull();
    expect(ctx.cellSpacing).toBeCloseTo(Math.sqrt((4 * Math.PI) / N), 12);
  });
});
