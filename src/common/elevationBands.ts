// The elevation discretization: raw elevation [-1..1] → band + colour family. This is the ONE home
// for "which band is this height", shared by the renderer's biome colouring (biomes.ts) AND the
// generation hillshade gate (ElevationCalculator). It lives in `common` so generation never has to
// reach into the render-side `biomes` module to gate shading on the mountain elevations.

export type ElevationFamily = "OCEAN" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

// Raw elevation domain is [-1..1], ocean is [-1..0], land is [0..1].
// Breaks are inclusive upper-bounds for each band.
export type ElevationBand =
  | "OCEAN_1"
  | "OCEAN_2"
  | "OCEAN_3"
  | "LOW_1"
  | "LOW_2"
  | "MEDIUM_1"
  | "MEDIUM_2"
  | "HIGH_1"
  | "HIGH_2"
  | "VERY_HIGH_1"
  | "VERY_HIGH_2";

export const ELEVATION_BAND_BREAKS: readonly {
  breakPoint: number;
  band: ElevationBand;
  colorElevation: ElevationFamily;
}[] = [
  { breakPoint: -0.7, colorElevation: "OCEAN", band: "OCEAN_3" }, // deep
  { breakPoint: -0.35, colorElevation: "OCEAN", band: "OCEAN_2" }, // medium
  { breakPoint: 0, colorElevation: "OCEAN", band: "OCEAN_1" }, // shallow
  { breakPoint: 0.2, colorElevation: "LOW", band: "LOW_1" },
  { breakPoint: 0.22, colorElevation: "LOW", band: "LOW_2" },
  { breakPoint: 0.35, colorElevation: "MEDIUM", band: "MEDIUM_1" },
  { breakPoint: 0.52, colorElevation: "MEDIUM", band: "MEDIUM_2" },
  { breakPoint: 0.62, colorElevation: "HIGH", band: "HIGH_1" },
  { breakPoint: 0.75, colorElevation: "HIGH", band: "HIGH_2" },
  { breakPoint: 0.87, colorElevation: "VERY_HIGH", band: "VERY_HIGH_1" },
  { breakPoint: 1.0, colorElevation: "VERY_HIGH", band: "VERY_HIGH_2" },
] as const;

// The landE (normalized [0,1] land elevation) at the MEDIUM→HIGH boundary — the break just before the
// first HIGH band. Hillshade uses it as the elevation where aerial-perspective shadows reach full depth
// (mountains): below it, the shadow floor is lifted toward flat so lowlands shade gently. Shared by the
// GPU field (uShadeMinLandE uniform) and the CPU ElevationCalculator so both stay in exact sync.
export const SHADE_MIN_LAND_E =
  ELEVATION_BAND_BREAKS[
    ELEVATION_BAND_BREAKS.findIndex((b) => b.colorElevation === "HIGH") - 1
  ].breakPoint;

// Continuous elevation -> unified band (the first break whose upper bound it falls under).
export function getElevationBandNameRaw(elevation: number): {
  breakPoint: number;
  colorElevation: ElevationFamily;
  band: ElevationBand;
} {
  const firstBreak = ELEVATION_BAND_BREAKS.find(
    ({ breakPoint }) => elevation < breakPoint
  );
  return firstBreak!;
}
