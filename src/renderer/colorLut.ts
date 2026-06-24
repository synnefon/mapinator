import { iceColorFor, type Theme } from "../common/biomes";
import { hexToRgb } from "../common/colorUtils";
import { colorAt } from "./BiomeColor";

// "BiomeColor in the shader", the cheap way: bake colorAt into a 2D LUT the GPU patch shader samples,
// instead of porting the HSL ramp / stops / theme logic to GLSL. Output is byte-identical to the CPU's
// colour (the shader samples NEAREST at the exact grid points it was built from). Rebuilt only when the
// theme / rainfall / dials change — cheap (size² colorAt calls). Ice is applied AFTER the lookup in the
// shader (the `ice` field × iceColorRgb), matching computeColorsFromFields' post-colorAt ice mix.

export const COLOR_LUT_SIZE = 256;

/**
 * RGBA8 colour LUT, `COLOR_LUT_SIZE`² texels: axis i = CONTRASTED elevation [0,1] (the shader applies
 * ELEVATION_CONTRAST to raw elevation, as `computeColorsFromFields` does before `colorAt`), axis j =
 * moisture [0,1]. texel = colorAt(theme, contrastedElevation, moisture, rainfall), pre-ice.
 */
export function buildColorLut(theme: Theme, rainfall: number): Uint8Array {
  const size = COLOR_LUT_SIZE;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const m = j / (size - 1);
    for (let i = 0; i < size; i++) {
      const e = i / (size - 1);
      const rgb = hexToRgb(colorAt(theme, e, m, rainfall)) ?? { r: 0, g: 0, b: 0 };
      const o = (j * size + i) * 4;
      data[o] = rgb.r;
      data[o + 1] = rgb.g;
      data[o + 2] = rgb.b;
      data[o + 3] = 255;
    }
  }
  return data;
}

/** The theme's ice/snow colour as 0–1 RGB, for the shader's post-lookup ice mix. */
export function iceColorRgb(theme: Theme): [number, number, number] {
  const rgb = hexToRgb(iceColorFor(theme)) ?? { r: 255, g: 255, b: 255 };
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
}
