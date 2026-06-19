import { geoVoronoi } from "d3-geo-voronoi";
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { GlobeCell, GlobeMap, Vec3 } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  FRACTAL,
  INVARIANTS,
  MOISTURE,
  MOUNTAIN,
  OCEAN,
  RAINFALL,
  SLIDER_RANGES,
  sampleDial,
  type MapSettings,
} from "../common/settings";
import { applyContrast, clamp, lerp } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import { fbm3 } from "./fbm";
import { fibonacciSphere, lonLatToVec3, vec3ToLonLat } from "./Sphere";

// Decorrelate the moisture field from the elevation field.
const MOISTURE_NOISE_OFFSET = 31.7;

/**
 * Generates a whole planet's worth of terrain ONCE per seed/resolution: points on
 * the unit sphere (Fibonacci), a spherical Voronoi mesh (geoVoronoi), and a raw
 * elevation + moisture per cell from 3D noise. Rotation/zoom never regenerate —
 * the renderer just re-projects. Sea level / theme are applied at render time.
 */
export class MapGenerator {
  private noise3D: NoiseFunction3D;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;
  private seed: string;

  public constructor(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise3D);
  }

  public reSeed(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise3D = createNoise3D(makeRNG(seed));
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise3D);
  }

  public generateMap(input: MapSettings): GlobeMap {
    const pointCount = Math.round(
      lerp(SLIDER_RANGES.POINT_COUNT[0], SLIDER_RANGES.POINT_COUNT[1], input.resolution)
    );

    // Per-seed "flavor" dials (relief/moisture wavelengths + rainfall bias).
    const flavorRng = makeRNG(this.seed + "-flavor");
    const coastWavelength = sampleDial(COAST.WAVELENGTH, flavorRng);
    const mountainWavelength = sampleDial(MOUNTAIN.WAVELENGTH, flavorRng);
    const moistureWavelength = sampleDial(MOISTURE.WAVELENGTH, flavorRng);
    const rainfall = sampleDial(RAINFALL, flavorRng);
    const oceanWavelength = sampleDial(OCEAN.WAVELENGTH, flavorRng);

    // Points on the sphere → spherical Voronoi cells (computed once).
    const sites = fibonacciSphere(pointCount);
    const voronoi = geoVoronoi(sites.map(vec3ToLonLat));
    const polygons = voronoi.polygons();

    const cells: GlobeCell[] = [];
    for (const feature of polygons.features) {
      const geometry = feature.geometry;
      if (!geometry || !geometry.coordinates) continue; // skip degenerate / Sphere
      const [siteLon, siteLat] = feature.properties.sitecoordinates;
      const site = lonLatToVec3(siteLon, siteLat);
      const ring = geometry.coordinates[0].map(([lon, lat]) => lonLatToVec3(lon, lat));
      const elevation = this.elevationCalc.elevationAt(
        site.x,
        site.y,
        site.z,
        coastWavelength,
        mountainWavelength,
        oceanWavelength
      );
      cells.push({
        site,
        ring,
        elevation,
        moisture: this.moistureAt(site, moistureWavelength),
      });
    }

    printSection(
      "GLOBE SETTINGS",
      { key: "pointCount", value: pointCount },
      { key: "cells", value: cells.length },
      { key: "moistureWavelength", value: moistureWavelength },
      { key: "rainfall", value: rainfall }
    );

    return { cells, rainfall, pointCount };
  }

  /** Moisture in [0,1] at a sphere point; contrast baked in (it's a fixed dial). */
  private moistureAt(site: Vec3, moistureWavelength: number): number {
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE_NOISE_OFFSET,
      site.y + MOISTURE_NOISE_OFFSET,
      site.z + MOISTURE_NOISE_OFFSET,
      moistureWavelength,
      MOISTURE.AMPLITUDE,
      FRACTAL.OCTAVES,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    const m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw);
    return applyContrast(m, MOISTURE.CONTRAST);
  }
}
