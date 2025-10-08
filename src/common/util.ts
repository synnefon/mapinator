// force a number between 0 and 1
export const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// linear interpolation
// map t from [x, y] to [a,b]
export const lerp = (
  a: number,
  b: number,
  t: number,
  x: number = 0,
  y: number = 1
) => a + ((b - a) * (t - x)) / (y - x);
