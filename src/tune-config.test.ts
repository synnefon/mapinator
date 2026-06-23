import { describe, expect, it } from "vitest";
// @ts-expect-error — tune-config.mjs is plain JS with no type declarations
import { recenterInSrc, setInSrc } from "../tune-config.mjs";

// Mirrors the descriptor format the /tune wizard rewrites on disk. WAVELENGTH appears in two
// sections on purpose — guards that the rewrite is section-scoped (the whole reason for blockRe).
const SAMPLE = `export const DIALS = {
  CONTINENT: {
    WAVELENGTH: { value: 2.45, doc: "larger = bigger, fewer continents" },
    WARP: { value: 0.3313, doc: "warp strength" },
  },
  OCEAN: {
    SHELF: { value: [0.474, 0.694] as Range, doc: "shelf band" },
  },
  MOISTURE: {
    WAVELENGTH: { value: 1.55, doc: "larger = bigger climate zones" },
  },
};`;

describe("tune-config rewrites the descriptor format", () => {
  it("recenters a scalar dial to the picked value", () => {
    const { src, value } = recenterInSrc(SAMPLE, "CONTINENT.WAVELENGTH", 3);
    expect(value).toBe(3);
    expect(src).toContain('WAVELENGTH: { value: 3, doc: "larger = bigger, fewer continents" }');
  });

  it("recenters a range dial around the pick, preserving its width", () => {
    const { src, value } = recenterInSrc(SAMPLE, "OCEAN.SHELF", 0.6);
    // width 0.694 - 0.474 = 0.22 → [0.6 - 0.11, 0.6 + 0.11]
    expect(value).toStrictEqual([0.49, 0.71]);
    expect(src).toContain("SHELF: { value: [0.49, 0.71] as Range");
  });

  it("setInSrc writes a scalar verbatim", () => {
    const { src, value } = setInSrc(SAMPLE, "CONTINENT.WARP", 0.5);
    expect(value).toBe(0.5);
    expect(src).toContain("WARP: { value: 0.5, doc:");
  });

  it("setInSrc sets one range endpoint and preserves the other", () => {
    const lo = setInSrc(SAMPLE, "OCEAN.SHELF.0", 0.4);
    expect(lo.value).toBe(0.4);
    expect(lo.src).toContain("SHELF: { value: [0.4, 0.694] as Range");
    const hi = setInSrc(SAMPLE, "OCEAN.SHELF.1", 0.8);
    expect(hi.value).toBe(0.8);
    expect(hi.src).toContain("SHELF: { value: [0.474, 0.8] as Range");
  });

  it("is section-scoped — rewriting one section's WAVELENGTH leaves the other's untouched", () => {
    const { src } = recenterInSrc(SAMPLE, "CONTINENT.WAVELENGTH", 3);
    expect(src).toContain('WAVELENGTH: { value: 3, doc: "larger = bigger, fewer continents" }');
    expect(src).toContain('WAVELENGTH: { value: 1.55, doc: "larger = bigger climate zones" }');
  });
});
