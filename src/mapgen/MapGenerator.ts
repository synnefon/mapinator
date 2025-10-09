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
      terrainFrequency: lerp(0.1, 1.3, 1 - input.terrainFrequency),
      weatherFrequency: lerp(0.1, 1.3, 1 - input.weatherFrequency),
      // clumpiness: lerp(-1, 1, input.clumpiness),
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
      edgeCurve,
      elevationContrast = 0.5,   // 0 = flat, 0.5 = identity, 1 = punchy
      terrainFrequency,
      clumpiness,                 // -1..1  (neg = Mediterranean, pos = Island)
    } = settings;

    // ---- helpers -------------------------------------------------------------

    // two-octave noise → ~[0,1]
    const fbm2 = (x: number, y: number) => {
      const s = terrainFrequency;
      const n1 = this.noise2D(x / s, y / s);
      const n2 = this.noise2D((2 * x) / s, (2 * y) / s);
      return clamp(0.5 + 0.35 * n1 + 0.15 * n2);
    };

    // 0 at center, →1 near edges (Chebyshev-ish)
    const edgeMask = (x: number, y: number) => {
      const d = 2 * Math.max(Math.abs(x), Math.abs(y));     // ~[0,1]
      const exp = lerp(0.5, 3.0, edgeCurve);
      return Math.pow(d, exp);
    };

    // ---- main ---------------------------------------------------------------

    const out = new Array<number>(numRegions);
    const c = clamp(clumpiness, -1, 1);   // -1..1
    const amt = Math.abs(c);               // 0..1

    for (let r = 0; r < numRegions; r++) {
      const x = lerp(-0.5, 0.5, points[r].x / resolution);
      const y = lerp(-0.5, 0.5, points[r].y / resolution);

      const base = fbm2(x, y);
      const mask = edgeMask(x, y);         // 0 center → 1 edges

      // Unified coast field C(c):
      //  c = +1 ⇒ C = (1 - mask)  (islandy: land center, water edges)
      //  c = -1 ⇒ C = mask        (Mediterranean: water center, land edges)
      //  c =  0 ⇒ C = 0.5         (neutral)
      const C = ((1 - c) * mask + (1 + c) * (1 - mask)) * 0.5;

      //  amt = |c| controls strength; c’s sign picked via C above.
      //  When amt=0 ⇒ e=base; when amt=1 ⇒ e=average(base, C).
      const e = base + 0.5 * amt * (C - base);

      out[r] = this.applyContrast(e, elevationContrast);
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
