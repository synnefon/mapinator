import { describe, expect, it } from "vitest";
import { Vec3 } from "../../common/3DMath";
import { OCEANS, RIVERS, snapshotParams } from "../../common/settings";
import { buildCpuCalc } from "../gpu/cpuField";
import { clipLinesToCoast, computeRivers, type Line, type RiverData, type RiverFieldSampler } from "./rivers";

// === Rivers end ON the coast — not short of it, not past it ===
// Routing decides land/sea on the COARSE skeleton mesh, so river lines used to miss the fractal rendered
// coast: a trunk ended at the first SEA cell's CENTRE (a cell past the shore) and a tributary (growBranch)
// walked great circles with no land/sea test at all. clipLinesToCoast cuts each line where the field
// actually crosses seaLevel, sub-sampling the mouth segment so the cut tracks the real coast rather than a
// linear guess between two cell centres (which a deep adjacent sea cell drags far inland — "stops short").

const PARAMS = snapshotParams();
const seaLevel = OCEANS.SEA_LEVEL.value;
const SEEDS = ["coast-a", "coast-b", "coast-c"];

/** A CPU river-field sampler (the GPU path's twin) plus the bare elevation lookup, so a test can re-sample
 *  the routed network against the exact field it was built from. */
function sampler(seed: string): { sample: RiverFieldSampler; elevationAt: (p: Vec3) => number } {
  const { calc } = buildCpuCalc(seed, PARAMS);
  const elevationAt = (p: Vec3): number => calc.sampleCell(p).elevation;
  const sample: RiverFieldSampler = (sites) => {
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
  return { sample, elevationAt };
}

describe("clipLinesToCoast", () => {
  // Synthetic field: land in the north (elevation falls smoothly with z), sea in the south. The coast is
  // the z = 0 great circle (elevation === seaLevel there). The KEY: the sea endpoint is DEEP, which a
  // linear cell-to-cell crossing would mistake for a coast right next to the land vertex.
  const SEA = 0.4;
  const elevAt = (z: number): number => SEA + 0.5 * z; // seaLevel SEA at z = 0; z = -1 ⇒ deep ocean (−0.1)
  const synthSampler: RiverFieldSampler = (sites) => {
    const m = sites.length / 3;
    const elevation = new Float32Array(m);
    for (let i = 0; i < m; i++) elevation[i] = elevAt(sites[3 * i + 2]); // z is component index 2
    return { elevation, reportElevation: elevation, moisture: new Float32Array(m), ice: new Float32Array(m) };
  };

  // A line marching south down the prime meridian: well inland → straight to a DEEP sea point.
  const onMeridian = (z: number): Vec3 => Vec3.normalize({ x: Math.sqrt(Math.max(0, 1 - z * z)), y: 0, z });
  const line: Line = {
    pts: [onMeridian(0.5), onMeridian(0.2), onMeridian(-0.9)], // last step crosses the coast into deep water
    str: [1, 0.8, 0.6],
  };

  it("cuts the line at the real coast (z ≈ 0), undeceived by a deep sea endpoint", () => {
    const [clipped] = clipLinesToCoast([line], synthSampler, SEA);
    const end = clipped.pts[clipped.pts.length - 1];
    // The true coast is z = 0. A naive linear crossing between the land point (z=0.2, elev 0.5) and the
    // deep point (z=−0.9, elev −0.05) would land at z ≈ 0.11 — well inland. Sub-cell marching lands on z=0.
    expect(Math.abs(end.z)).toBeLessThan(0.02);
    expect(Math.abs(elevAt(end.z) - SEA)).toBeLessThan(0.02); // i.e. the endpoint sits on the waterline
    expect(clipped.pts.length).toBe(3); // two land points kept + the coast crossing
  });

  it("keeps an all-land line whole and drops an all-sea line", () => {
    const allLand: Line = { pts: [onMeridian(0.6), onMeridian(0.4)], str: [1, 1] };
    const allSea: Line = { pts: [onMeridian(-0.4), onMeridian(-0.6)], str: [1, 1] };
    const out = clipLinesToCoast([allLand, allSea], synthSampler, SEA);
    expect(out).toHaveLength(1);
    expect(out[0].pts).toStrictEqual(allLand.pts); // untouched
  });
});

describe("rivers stop at the coast (full routing)", () => {
  /** Deepest a drawn vertex dips below seaLevel, and how close ANY vertex gets to the waterline. */
  function coastStats(rivers: RiverData, elevationAt: (p: Vec3) => number) {
    const { positions } = rivers;
    let maxBelow = 0; // worst penetration into the sea (0 = none)
    let minDist = Infinity; // closest a vertex gets to the coast, either side
    for (let i = 0; i < positions.length / 3; i++) {
      const e = elevationAt({ x: positions[3 * i], y: positions[3 * i + 1], z: positions[3 * i + 2] });
      if (e < seaLevel) maxBelow = Math.max(maxBelow, seaLevel - e);
      minDist = Math.min(minDist, Math.abs(e - seaLevel));
    }
    return { maxBelow, minDist, vertices: positions.length / 3 };
  }

  function route(sample: RiverFieldSampler, meanderDetail: number): RiverData {
    return computeRivers(sample, {
      seaLevel,
      minDrainage: RIVERS.MIN_DRAINAGE.value,
      moistureWeight: RIVERS.MOISTURE_WEIGHT.value,
      sourceMoisture: RIVERS.SOURCE_MOISTURE.value,
      waterScaling: RIVERS.WATER_SCALING.value,
      branching: RIVERS.BRANCHING.value,
      meander: meanderDetail > 0 ? RIVERS.MEANDER.value : 0,
      meanderDetail,
    });
  }

  it("reach the waterline without diving into open water", () => {
    for (const seed of SEEDS) {
      const { sample, elevationAt } = sampler(seed);
      const { maxBelow, minDist, vertices } = coastStats(route(sample, 0), elevationAt); // meander OFF — clip is exact
      expect(vertices).toBeGreaterThan(0); // there ARE rivers (the clip didn't empty the network)
      expect(minDist).toBeLessThan(0.01); // a mouth lands ON the coast (not stopping short)
      // No vertex juts into open water. The bar sits above the fractal coast's own roughness band (~0.015,
      // the deepest a cut lands inside the fuzzy shoreline) yet far below the bug's cell-deep overshoot (≥0.1).
      expect(maxBelow).toBeLessThan(0.03);
    }
  }, 60_000);

  it("survive meander refinement without diving into open water", () => {
    const { sample, elevationAt } = sampler(SEEDS[0]);
    const { maxBelow, vertices } = coastStats(route(sample, RIVERS.MEANDER_DETAIL.value), elevationAt); // meander ON
    expect(vertices).toBeGreaterThan(0);
    // A refined mouth can only wiggle by amplitude × its (sub-cell) chord, so any poke stays small.
    expect(maxBelow).toBeLessThan(0.05);
  }, 60_000);
});
