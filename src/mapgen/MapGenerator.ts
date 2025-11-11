import { Delaunay } from "d3-delaunay";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { BaseMap, WorldMap } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import { DIALS, sampleDial, type MapSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import { PointGenerator } from "./PointGenerator";

/** ================================================
 *  Named constants (no magic numbers)
 *  ================================================ */

// Resolution & frequency ranges
const RESOLUTION_RANGE: [number, number] = [10, 200];
const TERRAIN_FREQ_RANGE: [number, number] = [0.1, 1.3];
const WEATHER_FREQ_RANGE: [number, number] = [0.1, 1.3];

// Moisture defaults
const DEFAULT_MOISTURE_CONTRAST = 0.5;
const WARP_DIVISOR = 4;
const RIP_DIVISOR = 0.5;
const FBM_WEIGHTS = { n1: 0.35, n2: 0.15 };

// Elevation contrast parameters
const CONTRAST_AT_LOW_SEA = 0.45;
const CONTRAST_AT_HIGH_SEA = 1.0;
const SEA_LEVEL_CONTRAST_MIN = 0.2;
const SEA_LEVEL_CONTRAST_MAX = 0.9;

export class MapGenerator {
  private noise2D: NoiseFunction2D;
  private pointGenerator: PointGenerator;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;
  private seed: string;

  public constructor(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise2D);
  }

  public reSeed(seed: string) {
    this.seed = seed;
    this.rng = makeRNG(seed);
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise2D);
  }

  public generateMap(input: MapSettings): WorldMap {
    const settings: MapSettings = {
      ...input,
      resolution: lerp(...RESOLUTION_RANGE, input.resolution),
      terrainFrequency: lerp(...TERRAIN_FREQ_RANGE, 1 - input.terrainFrequency),
      weatherFrequency: lerp(...WEATHER_FREQ_RANGE, 1 - input.weatherFrequency),
    };

    const { resolution } = settings;
    const { centers } = this.pointGenerator.genPoints(settings);

    const jitterAmplitude = 0;
    const sites =
      jitterAmplitude === 0
        ? centers
        : centers.map((p) => ({
            x: p.x + (this.rng() - 0.5) * jitterAmplitude,
            y: p.y + (this.rng() - 0.5) * jitterAmplitude,
          }));

    const delaunay = Delaunay.from(
      sites,
      (p) => p.x,
      (p) => p.y
    );

    const baseMap: BaseMap = {
      points: sites,
      resolution,
      numRegions: sites.length,
      numTriangles: (delaunay.triangles.length / 3) | 0,
      numEdges: (delaunay.halfedges.filter((h) => h >= 0).length / 2) | 0,
      halfedges: delaunay.halfedges,
      triangles: delaunay.triangles,
      delaunay,
    };

    const moistures = this.genMoistures(baseMap, settings);
    const elevations = this.genElevations(baseMap, settings);


    return { ...baseMap, elevations, moistures };
  }

  private genMoistures(baseMap: BaseMap, settings: MapSettings): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const weatherFrequency = settings.weatherFrequency;
    const moistureContrast =
      settings.moistureContrast ?? DEFAULT_MOISTURE_CONTRAST;

    // Create a deterministic RNG for moisture generation to ensure consistent results
    const moistureRng = makeRNG(this.seed + "-moisture");
    const rippleIntensity = sampleDial(DIALS.RIPPLE_INTENSITY_RANGE, moistureRng);
    const warpFrequency = sampleDial(DIALS.WARP_FREQUENCY_RANGE, moistureRng);
    const warpStrength = sampleDial(DIALS.WARP_STRENGTH_RANGE, moistureRng);

    const fbm2w = (x: number, y: number) => {
      const n1 = this.noise2D(x / weatherFrequency, y / weatherFrequency);
      const n2 = this.noise2D(
        (2 * x) / weatherFrequency,
        (2 * y) / weatherFrequency
      );
      return Math.min(
        1,
        Math.max(0, 0.5 + FBM_WEIGHTS.n1 * n1 + FBM_WEIGHTS.n2 * n2)
      );
    };

    const out = new Float32Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
      const nx = points[r].x / resolution - 0.5;
      const ny = points[r].y / resolution - 0.5;

      const wx =
        nx +
        (warpStrength / WARP_DIVISOR) * (fbm2w(warpFrequency * nx, warpFrequency * ny) - 0.5);
      const wy =
        ny +
        (warpStrength / WARP_DIVISOR) * (fbm2w(warpFrequency * ny, warpFrequency * nx) - 0.5);
      const m = fbm2w((rippleIntensity / RIP_DIVISOR) * wx, (rippleIntensity / RIP_DIVISOR) * wy);

      out[r] = this.applyContrast(m, moistureContrast);
    }

    printSection(
      "MOISTURE SETTINGS",
      { key: "rippleIntensity", value: rippleIntensity },
      { key: "warpFrequency", value: warpFrequency },
      { key: "weatherFrequency", value: weatherFrequency },
      { key: "warpStrength", value: warpStrength },
      { key: "moistureContrast", value: moistureContrast },
    );
    return out;
  }

  private genElevations(baseMap: BaseMap, settings: MapSettings): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const { seaLevel, terrainFrequency, clumpiness } = settings;

    const normalizedSeaLevel = clamp(
      lerp(0, 1, seaLevel, SEA_LEVEL_CONTRAST_MIN, SEA_LEVEL_CONTRAST_MAX)
    );
    const easedSeaLevel =
      normalizedSeaLevel * normalizedSeaLevel * (3 - 2 * normalizedSeaLevel);
    const elevationContrast = lerp(
      CONTRAST_AT_LOW_SEA,
      CONTRAST_AT_HIGH_SEA,
      easedSeaLevel
    );

    const out = new Float32Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
      const x = lerp(-0.5, 0.5, points[r].x / resolution);
      const y = lerp(-0.5, 0.5, points[r].y / resolution);
      const elev = this.elevationCalc.maskedElevation(
        x,
        y,
        terrainFrequency,
        clumpiness
      );
      out[r] = elev === 10 ? elev : this.applyContrast(elev, elevationContrast);
    }

    return out;
  }

  private applyContrast(v: number, contrast: number): number {
    const t = clamp(contrast, 0, 1);
    const u = 2 * v - 1;
    const exp =
      t <= 0.5 ? lerp(3.0, 1.0, t / 0.5) : lerp(1.0, 0.2, (t - 0.5) / 0.5);
    const u2 = Math.sign(u) * Math.pow(Math.abs(u), exp);
    return clamp((u2 + 1) * 0.5, 0, 1);
  }
}
