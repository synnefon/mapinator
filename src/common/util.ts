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

// debounce function calls - waits for `delay` ms of inactivity before executing
export const debounce = <T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: number | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      fn(...args);
      timeoutId = undefined;
    }, delay);
  };
};

// Contrast curve around the midpoint (0.5). contrast 0..1: <0.5 softens (exp>1),
// >0.5 sharpens (exp<1). Used for elevation (sea-level dependent) and moisture.
export const applyContrast = (v: number, contrast: number): number => {
  const t = clamp(contrast, 0, 1);
  const u = 2 * v - 1;
  const exp =
    t <= 0.5 ? lerp(3.0, 1.0, t / 0.5) : lerp(1.0, 0.2, (t - 0.5) / 0.5);
  const u2 = Math.sign(u) * Math.pow(Math.abs(u), exp);
  return clamp((u2 + 1) * 0.5, 0, 1);
};
