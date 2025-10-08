import { Delaunay } from "d3-delaunay";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { BaseMap, WorldMap } from "../common/map";
import { makeRNG, type RNG } from "../common/random";
import type { MapSettings } from "../common/settings";
import { clamp, lerp } from "../common/util";
import { PointGenerator } from "./PointGenerator";

export class MapGenerator {
  private noise2D: NoiseFunction2D;
  private pointGenerator: PointGenerator;
  private rng: RNG;

  public constructor(seed: string) {
    this.rng = makeRNG(seed);
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
  }

  public reSeed(seed: string) {
    this.noise2D = createNoise2D(makeRNG(seed));
    this.pointGenerator = new PointGenerator(seed);
  }

  public generateMap(input: MapSettings): WorldMap {
    const settings: MapSettings = {
      ...input,
      resolution: lerp(10, 200, input.resolution),
      noiseScale: lerp(0.1, 1.3, input.noiseScale),
    };
    const { resolution } = settings;

    const { centers } = this.pointGenerator.genPoints(settings);

    // Optional: deterministic micro-jitter; or set jitterAmplitude = 0 to disable.
    const jitterAmplitude = 0; // try 0.0005 if you *must* jitter
    const sites =
      jitterAmplitude === 0
        ? centers
        : centers.map((p) => ({
            x: p.x + (this.rng() - 0.5) * jitterAmplitude,
            y: p.y + (this.rng() - 0.5) * jitterAmplitude,
          }));

    // Single source of truth: d3-delaunay for both arrays + voronoi()
    const delaunay = Delaunay.from(
      sites,
      (p) => p.x,
      (p) => p.y
    );

    const baseMap: BaseMap = {
      points: sites, // use the SAME coords the triangulation used
      resolution,
      numRegions: sites.length,
      numTriangles: (delaunay.triangles.length / 3) | 0,
      // halfedges length ≠ edge count; expose both if you like
      numEdges: (delaunay.halfedges.filter((h) => h >= 0).length / 2) | 0,
      halfedges: delaunay.halfedges,
      triangles: delaunay.triangles,
      delaunay, // keep d3-delaunay for downstream voronoi()
    };

    const elevations = this.genElevations(baseMap, settings);
    const moistures = this.genMoistures(baseMap, settings);

    return { ...baseMap, elevations, moistures };
  }

  private genMoistures(baseMap: BaseMap, settings: MapSettings): number[] {
    const { points, numRegions, resolution } = baseMap;
    const out = new Array<number>(numRegions);
    const s = settings.noiseScale;
    for (let r = 0; r < numRegions; r++) {
      const nx = points[r].x / resolution - 0.5;
      const ny = points[r].y / resolution - 0.5;
      const m = (1 + this.noise2D(nx / s, ny / s)) / 2;
      out[r] = clamp(m);
    }
    return out;
  }

  private genElevations(baseMap: BaseMap, settings: MapSettings): number[] {
    const { points, numRegions, resolution } = baseMap;
    const {
      edgeCurve,
      elevationContrast = 0.5,
      noiseScale,
      clumpiness,
    } = settings;

    const edgeExp = lerp(0.5, 3.0, edgeCurve);
    const out = new Array<number>(numRegions);

    // contrast curve
    const applyContrast = (e: number, c: number) => {
      const u = lerp(-1, 1, e);
      const gamma =
        c < 0.5 ? lerp(3.0, 1.0, c / 0.5) : lerp(1.0, 0.2, (c - 0.5) / 0.5);
      const uMod = Math.sign(u) * Math.pow(Math.abs(u), gamma);
      return clamp((uMod + 1) / 2);
    };

    for (let r = 0; r < numRegions; r++) {
      const nx = points[r].x / resolution - 0.5;
      const ny = points[r].y / resolution - 0.5;

      // two-octave FBM-ish
      let e =
        1 / 3 +
        this.noise2D(nx / noiseScale, ny / noiseScale) / 2 +
        this.noise2D((2 * nx) / noiseScale, (2 * ny) / noiseScale) / 3;

      // try Math.hypot(nx, ny) for rounder masks
      let d = 2 * Math.max(Math.abs(nx), Math.abs(ny));
      d = Math.pow(d, edgeExp);

      const clumpinessMasked = (1 + e - d) / 2;
      e = lerp(e, clumpinessMasked, clamp(clumpiness));

      out[r] = applyContrast(clamp(e), elevationContrast);
    }
    return out;
  }
}
