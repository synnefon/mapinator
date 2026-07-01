/**
 * Emit GLSL `const` lines from a TS constants object — the define-once bridge for the mirrored
 * shaders. The TS object is the single numeric source; the GLSL block is GENERATED from it, never
 * hand-copied, so retuning a constant on the CPU side cannot leave the GPU behind (the drift class
 * that shipped in ff8841b). Keys listed in `ints` emit `const int`; everything else `const float`.
 */
export function glslConstBlock(
  obj: Readonly<Record<string, number>>,
  prefix: string,
  ints: readonly string[] = []
): string {
  return Object.entries(obj)
    .map(([k, v]) =>
      ints.includes(k)
        ? `const int ${prefix}${k} = ${Math.round(v)};`
        : `const float ${prefix}${k} = ${glslFloat(v)};`
    )
    .join("\n");
}

/** A JS number as a GLSL float literal (integers gain a `.0`; exponent forms pass through). */
export function glslFloat(v: number): string {
  const s = String(v);
  return /[.e]/i.test(s) ? s : `${s}.0`;
}
