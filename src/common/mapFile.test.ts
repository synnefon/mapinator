import { beforeEach, describe, expect, it, vi } from "vitest";
import { Quat } from "./3DMath";
import { parseSave, serializeSave } from "./mapFile";
import { MAP_DEFAULTS } from "./settings";
import type { MapState } from "../AppState";

// parseSave alerts the user on malformed input; node has no alert.
const alertSpy = vi.fn();
vi.stubGlobal("alert", alertSpy);
beforeEach(() => alertSpy.mockClear());

const state = (over: Partial<MapState> = {}): MapState => ({
  seed: "TESTSEED",
  settings: { ...MAP_DEFAULTS, zoom: 0.4, viewCountries: true },
  tuning: { "OCEANS.SEA_LEVEL": 0.5 },
  orientation: { x: 0, y: 0.6, z: 0, w: 0.8 },
  language: "GREEK",
  features: { mountains: false },
  ...over,
});

describe("save file round-trip", () => {
  it("serialize → parse preserves the whole MapState, features included", () => {
    const parsed = parseSave(serializeSave(state()));
    expect(parsed).toStrictEqual(state());
  });

  it("omits the default theme on write and refills it on read", () => {
    const text = serializeSave(state());
    expect(text).not.toContain('"theme"');
    expect(parseSave(text)?.settings.theme).toBe(MAP_DEFAULTS.theme);
  });
});

describe("parseSave — legacy and malformed input", () => {
  it("a pre-feature save (no features field) parses with features undefined", () => {
    const legacy = JSON.stringify({ seed: "OLD", settings: { zoom: 0.2 } });
    const parsed = parseSave(legacy);
    expect(parsed?.seed).toBe("OLD");
    expect(parsed?.features).toBeUndefined();
    expect(parsed?.tuning).toStrictEqual({});
    expect(parsed?.orientation).toStrictEqual({ ...Quat.identity });
  });

  it("accepts the older mapSettings field name", () => {
    const parsed = parseSave(JSON.stringify({ seed: "OLD", mapSettings: { zoom: 0.9 } }));
    expect(parsed?.settings.zoom).toBe(0.9);
  });

  it("a features field with no valid boolean keys parses as undefined (not junk)", () => {
    const parsed = parseSave(JSON.stringify({ seed: "S", settings: {}, features: { mountains: "yes", bogus: true } }));
    expect(parsed?.features).toBeUndefined();
  });

  it("rejects non-JSON, non-object, missing-seed, and missing-settings files (alerting each time)", () => {
    expect(parseSave("not json")).toBeNull();
    expect(parseSave('"a string"')).toBeNull();
    expect(parseSave(JSON.stringify({ settings: {} }))).toBeNull();
    expect(parseSave(JSON.stringify({ seed: "S" }))).toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(4);
  });

  it("an invalid orientation falls back to identity", () => {
    const parsed = parseSave(JSON.stringify({ seed: "S", settings: {}, orientation: { x: 1 } }));
    expect(parsed?.orientation).toStrictEqual({ ...Quat.identity });
  });
});
