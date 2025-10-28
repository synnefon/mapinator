import { Delaunay } from "d3-delaunay";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { BaseMap, WorldMap } from "../common/map";
import { makeRNG, type RNG } from "../common/random";
import { ELEVATION_SETTINGS_DEFAULTS, type MapSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import { PointGenerator } from "./PointGenerator";

export class MapGenerator {
  private noise2D: NoiseFunction2D;
  private pointGenerator: PointGenerator;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;

  public constructor(seed: string) {
    this.rng = makeRNG(seed);
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
    this.elevationCalc = new ElevationCalculator(
      this.rng,
      this.noise2D,
      {}
    );
  }

  public reSeed(seed: string) {
    this.rng = makeRNG(seed);
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
    this.elevationCalc = new ElevationCalculator(this.rng, this.noise2D, {});
  }

  public generateMap(input: MapSettings): WorldMap {
    // console.log(clumpiness)
    const settings: MapSettings = {
      ...input,
      resolution: lerp(10, 200, input.resolution),
      terrainFrequency: lerp(0.1, 1.3, 1 - input.terrainFrequency),
      weatherFrequency: lerp(0.1, 1.3, 1 - input.weatherFrequency),
      // seaLevel: lerp(0.4, 0.6, input.seaLevel),
      // clumpiness: lerp(-0.9, 1.1, input.clumpiness, -1, 1)
      // clumpiness,
    };
    const { resolution } = settings;

    const { centers } = this.pointGenerator.genPoints(settings);

    // Optional jitter
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

    const elevations = this.genElevations(baseMap, settings);
    const moistures = this.genMoistures(baseMap, settings);

    return { ...baseMap, elevations, moistures };
  }

  private genMoistures(baseMap: BaseMap, settings: MapSettings): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const s = settings.weatherFrequency;
    const moistureContrast = settings.moistureContrast ?? 0.5; // 0.5 = identity

    // pull shared warp/ripple params from elevation
    const { kRip, kWarp, warpStrength } = ELEVATION_SETTINGS_DEFAULTS;

    // two-octave fbm ~ [0,1], same recipe as elevation
    const fbm2w = (x: number, y: number) => {
      const n1 = this.noise2D(x / s, y / s);
      const n2 = this.noise2D((2 * x) / s, (2 * y) / s);
      // clamp if you have it; otherwise Math.min/Max
      return Math.min(1, Math.max(0, 0.5 + 0.35 * n1 + 0.15 * n2));
    };

    const out = new Float32Array(numRegions);

    for (let r = 0; r < numRegions; r++) {
      // normalize coords to [-0.5, 0.5]
      const nx = points[r].x / resolution - 0.5;
      const ny = points[r].y / resolution - 0.5;

      const wx = nx + (warpStrength/3) * (fbm2w(kWarp * nx, kWarp * ny) - 0.5);
      const wy = ny + (warpStrength/3) * (fbm2w(kWarp * ny, kWarp * nx) - 0.5);

      // base moisture from fbm in [0,1], with kRip scaling
      const m = fbm2w((kRip/2) * wx, (kRip/2) * wy);

      // apply contrast like elevationContrast does
      out[r] = this.applyContrast(m, moistureContrast);
    }

    return out;
  }

  private genElevations(baseMap: BaseMap, settings: MapSettings): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const {
      seaLevel,
      terrainFrequency,
      clumpiness,
    } = settings;

    const out = new Float32Array(numRegions);

    // Define our desired output range for contrast.
    const CONTRAST_AT_LOW_SEA = 0.45; // medium contrast
    const CONTRAST_AT_HIGH_SEA = 1.0; // punchy contrast
    // Define the sea level range over which contrast ramps up.
    // (below min → medium contrast, above max → max contrast)
    const SEA_LEVEL_CONTRAST_MIN = 0.2;
    const SEA_LEVEL_CONTRAST_MAX = 0.9;
    // Normalize seaLevel into [0,1] within the ramp range.
    const normalizedSeaLevel = clamp(
      lerp(0, 1, seaLevel, SEA_LEVEL_CONTRAST_MIN, SEA_LEVEL_CONTRAST_MAX)
    );
    // Apply smoothstep easing to make the transition more gradual around mid-range.
    const easedSeaLevel = normalizedSeaLevel * normalizedSeaLevel * (3 - 2 * normalizedSeaLevel);
    // Lerp final contrast between medium and punchy depending on eased sea level.
    const elevationContrast = lerp(CONTRAST_AT_LOW_SEA, CONTRAST_AT_HIGH_SEA, easedSeaLevel);

    for (let r = 0; r < numRegions; r++) {
      const x = lerp(-0.5, 0.5, points[r].x / resolution);
      const y = lerp(-0.5, 0.5, points[r].y / resolution);
      const elev = this.elevationCalc.maskedElevation(x, y, terrainFrequency, clumpiness);
      out[r] = (elev === 10) ? elev : this.applyContrast(elev, elevationContrast);
    }

    return out;
  }

  private applyContrast(v: number, contrast: number): number {
    const t = clamp(contrast, 0, 1);
    const u = 2 * v - 1; // [-1,1] around 0
    const exp = t <= 0.5
      ? lerp(3.0, 1.0, t / 0.5)            // flatten
      : lerp(1.0, 0.2, (t - 0.5) / 0.5);   // boost
    const u2 = Math.sign(u) * Math.pow(Math.abs(u), exp);
    return clamp((u2 + 1) * 0.5, 0, 1);
  };
}
