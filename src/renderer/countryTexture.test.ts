import { describe, expect, it } from "vitest";
import { OCEAN, snapshotParams, type MapSettings } from "../common/settings";
import { buildAdjacency } from "../mapgen/features/adjacency";
import { assignCountries, fourColorCountries } from "../mapgen/features/countries";
import { MapGenerator } from "../mapgen/MapGenerator";
import { NameGenerator } from "../mapgen/NameGenerator";
import { bakeCountryTexture, COUNTRY_TEX_H, COUNTRY_TEX_W } from "./countryTexture";

const SETTINGS: MapSettings = { resolution: 1, zoom: 0, theme: "lush" };

describe("bakeCountryTexture", () => {
  it("bakes a full equirect RGBA texture of country hues over land and a dark sea", () => {
    const seed = "ctex-seed";
    const map = new MapGenerator(seed, snapshotParams()).generateMap(SETTINGS);
    const seaLevel = OCEAN.SEA_LEVEL.value;
    const adjacency = buildAdjacency(map);
    const { countryOf, countries } = assignCountries(
      map, seaLevel, adjacency, seed, "GREEK", ["LATIN"], new NameGenerator("c")
    );
    const colors = fourColorCountries(countryOf, adjacency, countries.length);
    const tex = bakeCountryTexture(map, countryOf, colors);

    expect(tex.length).toBe(COUNTRY_TEX_W * COUNTRY_TEX_H * 4);
    let land = 0;
    let sea = 0;
    for (let i = 0; i < tex.length; i += 4) {
      expect(tex[i + 3]).toBeGreaterThan(0); // every texel classified → a non-zero blend amount
      if (tex[i] === 0 && tex[i + 1] === 0 && tex[i + 2] === 0) sea++; // black = country-less water
      else land++;
    }
    // The kd-tree nearest-cell lookup should split the globe into both tinted land and dark sea.
    expect(land).toBeGreaterThan(0);
    expect(sea).toBeGreaterThan(0);
  });
});
