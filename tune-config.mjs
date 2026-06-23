// Dev-only helper for the tuning wizard (/tune): rewrites dial values in src/common/settings.ts.
// A pick RECENTERS the dial's current range around the picked value (preserve width, new center =
// pick): range [lo,hi] (width w) → [pick - w/2, pick + w/2]; a scalar dial is just set to the pick.
// Section-scoped, because keys like AMPLITUDE appear in several sections.
import { readFileSync, writeFileSync } from "node:fs";

const round = (x) => Math.round(x * 1e4) / 1e4;

/**
 * Recenter the dial at `path` ("SECTION.KEY") around `value` within the settings source string.
 * Returns { src, value } where value is the new [lo,hi] (range) or number (scalar).
 */
export function recenterInSrc(src, path, value) {
  const [section, key] = path.split(".");
  // Isolate the section block: "  SECTION: {" … "  }," (keys are 4-space indented, so the first
  // "\n  }," after the header is the section's own close).
  const blockRe = new RegExp(`\\n  ${section}: \\{[\\s\\S]*?\\n  \\},`);
  const bm = src.match(blockRe);
  if (!bm) throw new Error(`section "${section}" not found in settings`);
  const block = bm[0];

  const rangeRe = new RegExp(`(\\n    ${key}: \\{ value: )\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\] as Range`);
  const scalarRe = new RegExp(`(\\n    ${key}: \\{ value: )(-?[\\d.]+)`);

  let newValue;
  let newBlock;
  if (rangeRe.test(block)) {
    newBlock = block.replace(rangeRe, (_, pre, lo, hi) => {
      const w = parseFloat(hi) - parseFloat(lo); // preserve the current spread
      newValue = [round(Math.max(0, value - w / 2)), round(value + w / 2)];
      return `${pre}[${newValue[0]}, ${newValue[1]}] as Range`;
    });
  } else if (scalarRe.test(block)) {
    newValue = round(value);
    newBlock = block.replace(scalarRe, (_, pre) => `${pre}${newValue}`);
  } else {
    throw new Error(`dial "${path}" not found`);
  }
  return { src: src.replace(block, newBlock), value: newValue };
}

/** Apply every pick to settings.ts on disk (one read, one write). Returns the new values. */
export function applyPicks(file, picks) {
  if (!Array.isArray(picks) || picks.length === 0) throw new Error("no picks");
  let src = readFileSync(file, "utf8");
  const results = [];
  for (const { path, value } of picks) {
    if (typeof path !== "string" || typeof value !== "number") throw new Error("bad pick");
    const r = recenterInSrc(src, path, value);
    src = r.src;
    results.push({ path, value: r.value });
  }
  writeFileSync(file, src);
  return results;
}

/**
 * Set the dial at `path` to an EXACT value (no recentering) in the settings source — used by the
 * main app's "save current settings" button, which writes the live dial values verbatim. `path` is
 * "SECTION.KEY" for a scalar, or "SECTION.KEY.0" / "SECTION.KEY.1" for one endpoint of a [lo, hi]
 * range (the other endpoint is preserved). Returns { src, value } with the value actually written.
 */
export function setInSrc(src, path, value) {
  const [section, key, idx] = path.split(".");
  // Isolate the section block, exactly as recenterInSrc does (keys appear in several sections).
  const blockRe = new RegExp(`\\n  ${section}: \\{[\\s\\S]*?\\n  \\},`);
  const bm = src.match(blockRe);
  if (!bm) throw new Error(`section "${section}" not found in settings`);
  const block = bm[0];
  const v = round(value);

  let newBlock;
  if (idx === "0" || idx === "1") {
    const rangeRe = new RegExp(
      `(\\n    ${key}: \\{ value: \\[\\s*)(-?[\\d.]+)(\\s*,\\s*)(-?[\\d.]+)(\\s*\\] as Range)`
    );
    if (!rangeRe.test(block)) throw new Error(`range dial "${section}.${key}" not found`);
    newBlock = block.replace(rangeRe, (_, pre, lo, mid, hi, post) =>
      idx === "0" ? `${pre}${v}${mid}${hi}${post}` : `${pre}${lo}${mid}${v}${post}`
    );
  } else {
    const scalarRe = new RegExp(`(\\n    ${key}: \\{ value: )(-?[\\d.]+)`);
    if (!scalarRe.test(block)) throw new Error(`scalar dial "${path}" not found`);
    newBlock = block.replace(scalarRe, (_, pre) => `${pre}${v}`);
  }
  return { src: src.replace(block, newBlock), value: v };
}

/** Write every (path, value) literally to settings.ts (one read, one write). Returns new values. */
export function applyValues(file, values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("no values");
  let src = readFileSync(file, "utf8");
  const results = [];
  console.log("applyValues", values);
  for (const { path, value } of values) {
    if (typeof path !== "string" || typeof value !== "number") throw new Error("bad value");
    const r = setInSrc(src, path, value);
    src = r.src;
    results.push({ path, value: r.value });
  }
  writeFileSync(file, src);
  return results;
}
