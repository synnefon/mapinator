import { Delaunay } from "d3-delaunay";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { BaseMap, WorldMap } from "../common/map";
import { makeRNG, type RNG } from "../common/random";
import type { MapSettings } from "../common/settings";
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
    const settings: MapSettings = {
      ...input,
      resolution: lerp(10, 200, input.resolution),
      terrainFrequency: lerp(0.1, 1.3, 1 - input.terrainFrequency),
      weatherFrequency: lerp(0.1, 1.3, 1 - input.weatherFrequency),
      clumpiness: lerp(-0.9, 1.1, input.clumpiness, -1, 1)
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

  private genMoistures(baseMap: BaseMap, settings: MapSettings): number[] {
    const { points, numRegions, resolution } = baseMap;
    const s = settings.weatherFrequency;
    const moistureContrast = settings.moistureContrast ?? 0.5; // 0.5 = identity

    const out = new Array<number>(numRegions);

    for (let r = 0; r < numRegions; r++) {
      const nx = points[r].x / resolution - 0.5;
      const ny = points[r].y / resolution - 0.5;

      // base moisture from noise in [0,1]
      const m = (1 + this.noise2D(nx / s, ny / s)) / 2;

      // apply contrast like elevationContrast does
      out[r] = this.applyContrast(m, moistureContrast);
    }

    return out;
  }

  private genElevations(baseMap: BaseMap, settings: MapSettings): number[] {
    const { points, numRegions, resolution } = baseMap;
    const {
      elevationContrast = 0.5,   // 0 = flat, 0.5 = identity, 1 = punchy
      terrainFrequency,
      clumpiness,                 // -1..1  (neg = Mediterranean, pos = Island)
    } = settings;

    const out = new Array<number>(numRegions);

    for (let r = 0; r < numRegions; r++) {
      const x = lerp(-0.5, 0.5, points[r].x / resolution);
      const y = lerp(-0.5, 0.5, points[r].y / resolution);
      const elev = this.elevationCalc.maskedElevation(x, y, terrainFrequency, clumpiness);
      out[r] = this.applyContrast(elev, elevationContrast);
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
