import { describe, expect, it } from "vitest";
import { applyContrast, clamp, lerp, smoothstep } from "./util";

describe("clamp", () => {
  it("bounds to [0,1] by default", () => {
    expect(clamp(-0.5)).toBe(0);
    expect(clamp(0.3)).toBe(0.3);
    expect(clamp(2)).toBe(1);
  });
  it("honours explicit bounds", () => {
    expect(clamp(5, 1, 3)).toBe(3);
    expect(clamp(0, 1, 3)).toBe(1);
  });
});

describe("lerp", () => {
  it("interpolates the default [0,1] source range", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 1)).toBe(20);
  });
  it("remaps an arbitrary source range", () => {
    expect(lerp(0, 100, 5, 0, 10)).toBe(50);
  });
});

describe("smoothstep", () => {
  it("is 0 below a, 1 above b, and 0.5 at the midpoint", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 12);
  });
});

describe("applyContrast", () => {
  it("fixes the midpoint and the endpoints", () => {
    expect(applyContrast(0.5, 0.7)).toBeCloseTo(0.5, 12);
    expect(applyContrast(0, 0.7)).toBe(0);
    expect(applyContrast(1, 0.7)).toBe(1);
  });
  it("contrast > 0.5 sharpens away from the midpoint", () => {
    // a value above the midpoint is pushed higher when sharpened
    expect(applyContrast(0.75, 0.9)).toBeGreaterThan(0.75);
  });
});
