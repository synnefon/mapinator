// Pure (no-WebGL) helpers for the GPU field path, split out so they're unit-testable in the node
// env (vite.config.js test env is "node" — no DOM/WebGL).

/** Texture dimensions that hold `n` cells one-per-texel: a fixed-width strip (capped by the GPU's
 *  max texture size) with as many rows as needed. Returns the chosen width, the row count, and
 *  whether it fits (height also within maxTextureSize). For n beyond width*maxTextureSize the field
 *  would need tiling — `fits` is false and the caller must split the work. */
export function fieldTextureDims(
  n: number,
  maxTextureSize: number
): { width: number; height: number; fits: boolean } {
  if (n <= 0) return { width: 1, height: 1, fits: true };
  const width = Math.min(maxTextureSize, Math.max(1, Math.ceil(Math.sqrt(n))));
  const height = Math.ceil(n / width);
  return { width, height, fits: height <= maxTextureSize };
}
