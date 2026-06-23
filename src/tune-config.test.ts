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

// The actual settings.ts writes dials MULTI-LINE (value on its own indented line, doc beneath) —
// the layout that broke the single-line regexes (the "scalar dial not found" save failure).
const MULTILINE = `export const DIALS = {
  CONTINENT: {
    OCTAVES: {
      value: 4.5,
      doc: "detail layers",
    },
  },
  OCEAN: {
    SHELF: {
      value: [0.474, 0.694] as Range,
      doc: "shelf band",
    },
  },
};`;

describe("tune-config handles the multi-line dial layout", () => {
  it("recenters a multi-line scalar dial", () => {
    const { src, value } = recenterInSrc(MULTILINE, "CONTINENT.OCTAVES", 5);
    expect(value).toBe(5);
    expect(src).toContain("OCTAVES: {\n      value: 5,");
    expect(src).toContain('doc: "detail layers"'); // doc preserved
  });

  it("setInSrc writes a multi-line scalar verbatim (the save path that failed)", () => {
    const { src, value } = setInSrc(MULTILINE, "CONTINENT.OCTAVES", 6);
    expect(value).toBe(6);
    expect(src).toContain("OCTAVES: {\n      value: 6,");
  });

  it("setInSrc sets one endpoint of a multi-line range, preserving the other", () => {
    const { src } = setInSrc(MULTILINE, "OCEAN.SHELF.1", 0.8);
    expect(src).toContain("value: [0.474, 0.8] as Range");
  });
});
