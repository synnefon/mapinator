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

  const rangeRe = new RegExp(`(\\n    ${key}: )\\[\\s*(-?[\\d.]+)\\s*,\\s*(-?[\\d.]+)\\s*\\] as Range`);
  const scalarRe = new RegExp(`(\\n    ${key}: )(-?[\\d.]+)`);

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
