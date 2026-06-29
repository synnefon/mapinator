import { afterEach, describe, expect, it } from "vitest";
import {
  applyTuning,
  FEATURE_DEFAULTS,
  GENERATION_GROUPS,
  OCEANS,
  snapshotParams,
  tuningDefault,
} from "./settings";

// applyTuning mutates the live module-global dials, so each test restores pristine defaults.
afterEach(() => applyTuning({}));

describe("snapshotParams / GENERATION_GROUPS (the worker seam)", () => {
  it("captures exactly the generation groups plus features", () => {
    const expected = [...Object.keys(GENERATION_GROUPS), "features"].sort();
    expect(Object.keys(snapshotParams()).sort()).toStrictEqual(expected);
  });

  it("includes the live feature switches at their defaults", () => {
    expect(snapshotParams().features).toStrictEqual(FEATURE_DEFAULTS);
  });

  it("round-trips a scalar dial: applyTuning is reflected, then reverts", () => {
    applyTuning({ "OCEANS.SEA_LEVEL": 0.6 });
    expect(snapshotParams().OCEANS.SEA_LEVEL).toBe(0.6);
    applyTuning({});
    expect(snapshotParams().OCEANS.SEA_LEVEL).toBe(tuningDefault("OCEANS.SEA_LEVEL"));
  });

  it("round-trips a range endpoint (OCEANS.SHELF.0)", () => {
    applyTuning({ "OCEANS.SHELF.0": 0.4 });
    expect(snapshotParams().OCEANS.SHELF[0]).toBe(0.4);
  });

  it("deep-copies ranges so a snapshot can't mutate the live dial or a later snapshot", () => {
    const a = snapshotParams();
    const liveBefore = OCEANS.SHELF.value[0];
    a.OCEANS.SHELF[0] = 0.123;
    expect(snapshotParams().OCEANS.SHELF[0]).not.toBe(0.123); // a fresh snapshot is untouched
    expect(OCEANS.SHELF.value[0]).toBe(liveBefore); // the live dial is untouched
  });
});
