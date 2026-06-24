import { describe, expect, it } from "vitest";
import { fieldTextureDims } from "./gpuFieldLayout";

describe("fieldTextureDims", () => {
  it("covers every cell with one texel, no smaller than n", () => {
    for (const n of [1, 400, 100_000, 1_000_000, 11_000_000]) {
      const { width, height, fits } = fieldTextureDims(n, 4096);
      expect(width * height).toBeGreaterThanOrEqual(n);
      expect(width).toBeLessThanOrEqual(4096);
      expect(fits).toBe(true);
    }
  });

  it("keeps the strip near-square so neither dimension blows past the cap early", () => {
    // 1M cells: width ~1000 rows ~1000, both well under a 4096 cap.
    const { width, height } = fieldTextureDims(1_000_000, 4096);
    expect(width).toBe(1000);
    expect(height).toBe(1000);
  });

  it("flags n that needs tiling (height would exceed the cap)", () => {
    // width caps at 16, so 16*16 = 256 texels max; 300 cells can't fit → tiling required.
    expect(fieldTextureDims(300, 16).fits).toBe(false);
    // 11M with a 2048 cap: width 2048, height ~5372 > 2048 → does not fit.
    expect(fieldTextureDims(11_000_000, 2048).fits).toBe(false);
  });

  it("handles the empty/degenerate case", () => {
    expect(fieldTextureDims(0, 4096)).toStrictEqual({ width: 1, height: 1, fits: true });
  });
});
