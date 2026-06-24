import { describe, expect, it } from "vitest";
import { hexToRgb } from "../common/colorUtils";
import { colorAt } from "./BiomeColor";
import { buildColorLut, COLOR_LUT_SIZE } from "./colorLut";

// The shader samples the LUT NEAREST at the grid points it was built from, so the colour it gets must
// equal colorAt at those points exactly — the LUT is a faithful stand-in for the CPU colour pipeline.
describe("buildColorLut", () => {
  it("reproduces colorAt at grid points", () => {
    const theme = "lush";
    const rainfall = 0.68;
    const lut = buildColorLut(theme, rainfall);
    const size = COLOR_LUT_SIZE;
    for (const [i, j] of [[0, 0], [10, 200], [128, 128], [255, 255], [200, 40], [60, 250]]) {
      const e = i / (size - 1), m = j / (size - 1);
      const rgb = hexToRgb(colorAt(theme, e, m, rainfall))!;
      const o = (j * size + i) * 4;
      expect([lut[o], lut[o + 1], lut[o + 2], lut[o + 3]]).toStrictEqual([rgb.r, rgb.g, rgb.b, 255]);
    }
  });

  it("is the right size and fully opaque", () => {
    const lut = buildColorLut("lush", 0.5);
    expect(lut.length).toBe(COLOR_LUT_SIZE * COLOR_LUT_SIZE * 4);
    for (let p = 3; p < lut.length; p += 4) expect(lut[p]).toBe(255);
  });
});
