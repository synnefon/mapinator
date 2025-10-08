// force a number between 0 and 1
export const clamp = (x: number, min: number = 0, max: number = 1) =>
  x < min ? min : x > max ? max : x;

// linear interpolation
// map t from [srcMin, srcMax] to [dstMin, dstMax]
export const lerp = (
  dstMin: number,
  dstMax: number,
  t: number,
  srcMin: number = 0,
  srcMax: number = 1
) => dstMin + ((dstMax - dstMin) * (t - srcMin)) / (srcMax - srcMin);
