import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppState } from "./AppState";
import { FEATURE_DEFAULTS } from "./common/settings";

// AppState reads the URL for its initial settings; give node a minimal window.
vi.stubGlobal("window", { location: { href: "http://localhost/" } });

// FEATURES is the module-global live copy — reset between tests so they don't couple.
const fresh = (): AppState => {
  const s = new AppState();
  s.resetFeatures();
  return s;
};

describe("AppState — feature switches ride the store", () => {
  beforeEach(() => new AppState().resetFeatures());

  it("setFeature flips the live switch and snapshot() captures it", () => {
    const s = fresh();
    expect(s.features.mountains).toBe(FEATURE_DEFAULTS.mountains);
    s.setFeature("mountains", false);
    expect(s.features.mountains).toBe(false);
    expect(s.snapshot().features).toStrictEqual({ mountains: false });
  });

  it("snapshot() deep-copies: later toggles don't mutate an existing snapshot", () => {
    const s = fresh();
    const snap = s.snapshot();
    s.setFeature("mountains", false);
    expect(snap.features).toStrictEqual({ mountains: true });
  });

  it("restore() applies saved features — a save made with mountains off loads with mountains off", () => {
    const s = fresh();
    const savedOff = s.snapshot();
    savedOff.features = { mountains: false };
    s.restore(savedOff);
    expect(s.features.mountains).toBe(false);
  });

  it("restore() of a pre-feature save keeps the current switches (legacy behaviour)", () => {
    const s = fresh();
    s.setFeature("mountains", false);
    const legacy = s.snapshot();
    delete legacy.features;
    s.restore(legacy);
    expect(s.features.mountains).toBe(false); // untouched, not silently reset
  });

  it("resetFeatures() returns every switch to its default", () => {
    const s = fresh();
    s.setFeature("mountains", false);
    s.resetFeatures();
    expect({ ...s.features }).toStrictEqual(FEATURE_DEFAULTS);
  });
});
