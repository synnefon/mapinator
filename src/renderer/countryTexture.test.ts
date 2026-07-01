import { describe, expect, it } from "vitest";
import { OCEANS, snapshotParams, type MapSettings } from "../common/settings";
import { buildAdjacency } from "../mapgen/features/adjacency";
import { assignCountries, colorCountries } from "../mapgen/features/countries";
import { MapGenerator } from "../mapgen/MapGenerator";
import { NameGenerator } from "../mapgen/NameGenerator";
import { bakeCountryTexture, COUNTRY_TEX_H, COUNTRY_TEX_W } from "./countryTexture";

const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };

describe("bakeCountryTexture", () => {
  it("flags land vs sea in alpha (255/0) and tints every texel with a dilated country hue", () => {
    const seed = "ctex-seed";
    const map = new MapGenerator(seed, snapshotParams()).generateMap(SETTINGS);
    const seaLevel = OCEANS.SEA_LEVEL.value;
    const adjacency = buildAdjacency(map);
    const { countryOf, countries } = assignCountries(
      map, map.reportElevation, seaLevel, adjacency, seed, "GREEK", ["LATIN"], new NameGenerator("c")
    );
    const colors = colorCountries(countryOf, adjacency, countries.length);
    const tex = bakeCountryTexture(map, countryOf, colors);

    expect(tex.length).toBe(COUNTRY_TEX_W * COUNTRY_TEX_H * 4);
    let land = 0;
    let sea = 0;
    for (let i = 0; i < tex.length; i += 4) {
      const a = tex[i + 3];
      expect(a === 0 || a === 255).toBe(true); // alpha is a land/sea FLAG, not a blend amount
      if (a === 255) land++;
      else sea++;
      // rgb is the nearest-LAND country hue, dilated over water too → never left black
      expect(tex[i] + tex[i + 1] + tex[i + 2]).toBeGreaterThan(0);
    }
    // The globe splits into both land (alpha 255) and sea (alpha 0).
    expect(land).toBeGreaterThan(0);
    expect(sea).toBeGreaterThan(0);
    // Full-globe generation runs ~4.5s alone and tips the 5s default under parallel suite load.
  }, 60_000);
});
