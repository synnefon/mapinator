import { describe, expect, it } from "vitest";
import { enumerateReachableFunFacts } from "./funFactAudit";

// Enumerates EVERY reachable fun fact (see funFactAudit.ts). The engine is oddity-only: each fact is a
// whole authored one-liner, or an oddity-grade template with a gated noun slot (food / landmark / craft).
// These guards keep the corpus honest — no leaked tokens, no broken casing — and confirm the slot patterns
// actually multiply into a large, varied surface.
describe("fun-fact oddity audit", () => {
  const all = [...enumerateReachableFunFacts("Aldoria")];

  it("reaches a large set of oddities", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("never leaks a template token", () => {
    expect(all.filter((f) => /[{}]/.test(f))).toEqual([]);
  });

  it("renders every slot (no empty fragments from an unfilled slot)", () => {
    // An unfilled slot renders to "" and leaves a doubled space or a dangling article/preposition.
    expect(all.filter((f) => /\s{2,}/.test(f) || /\b(the|local|town's)\s*$/.test(f))).toEqual([]);
  });

  it("keeps the all-lowercase house style (only {country} introduces capitals)", () => {
    // UI text is uniformly lowercase and cased at the display layer; the only capitals come from the
    // substituted country name. Strip it, then nothing should remain capitalized.
    const stripped = all.map((f) => f.replace(/Aldoria/g, ""));
    expect(stripped.filter((f) => /[A-Z]/.test(f))).toEqual([]);
  });

  it("carries no stray terminal punctuation", () => {
    expect(all.filter((f) => /[.]$/.test(f))).toEqual([]);
  });
});
