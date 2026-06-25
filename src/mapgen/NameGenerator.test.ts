import { describe, expect, it } from "vitest";
import { NameGenerator } from "./NameGenerator";

describe("NameGenerator", () => {
  it("pure mode (default) repeats the same name for the same seed", () => {
    const namer = new NameGenerator("u");
    const a = namer.generate({ seed: "p", lang: "GREEK" });
    const b = namer.generate({ seed: "p", lang: "GREEK" });
    expect(b).toBe(a); // no dedup → idempotent in (seed, lang)
  });

  it("unique mode never repeats a name", () => {
    const namer = new NameGenerator("u");
    const names: string[] = [];
    for (let i = 0; i < 80; i++) names.push(namer.generate({ seed: `s${i}`, lang: "GREEK", unique: true }));
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  it("unique mode re-rolls when the same seed would collide", () => {
    const namer = new NameGenerator("u");
    const a = namer.generate({ seed: "x", lang: "GREEK", unique: true });
    const b = namer.generate({ seed: "x", lang: "GREEK", unique: true }); // same seed, already taken
    expect(b.toLowerCase()).not.toBe(a.toLowerCase());
  });

  it("resetUniqueness restarts the namespace so a sequence reproduces", () => {
    const namer = new NameGenerator("u");
    const first: string[] = [];
    for (let i = 0; i < 40; i++) first.push(namer.generate({ seed: `s${i}`, lang: "GREEK", unique: true }));
    namer.resetUniqueness();
    const second: string[] = [];
    for (let i = 0; i < 40; i++) second.push(namer.generate({ seed: `s${i}`, lang: "GREEK", unique: true }));
    expect(second).toStrictEqual(first); // deterministic across reset — never accumulates
  });
});
