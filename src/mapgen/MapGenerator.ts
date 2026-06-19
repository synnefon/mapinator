import { Delaunay } from "d3-delaunay";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { BaseMap, WorldMap } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  CONTRAST,
  FRACTAL,
  INVARIANTS,
  MOISTURE,
  MOUNTAIN,
  OCEAN,
  RAINFALL,
  SLIDER_RANGES,
  sampleDial,
  scaleZoom,
  type MapSettings,
} from "../common/settings";
import { clamp, lerp } from "../common/util";
import { ElevationCalculator } from "./ElevationCalculator";
import { fbm } from "./fbm";
import { PointGenerator } from "./PointGenerator";

// Offset that decorrelates the moisture field from the elevation/carrier fields.
const MOISTURE_NOISE_OFFSET = 31.7;

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
    const resolution = lerp(...SLIDER_RANGES.RESOLUTION, input.resolution);

    // Per-seed "flavor" dials (feature/moisture wavelength + rainfall bias).
    const flavorRng = makeRNG(this.seed + "-flavor");
    const coastWavelength = sampleDial(COAST.WAVELENGTH, flavorRng);
    const mountainWavelength = sampleDial(MOUNTAIN.WAVELENGTH, flavorRng);
    const moistureWavelength = sampleDial(MOISTURE.WAVELENGTH, flavorRng);
    const rainfall = sampleDial(RAINFALL, flavorRng);
    // Appended last so adding it doesn't reshuffle land/moisture dials per seed.
    const oceanWavelength = sampleDial(OCEAN.WAVELENGTH, flavorRng);

    const { centers } = this.pointGenerator.genPoints({ ...input, resolution });

    const delaunay = Delaunay.from(
      centers,
      (p) => p.x,
      (p) => p.y
    );

    const baseMap: BaseMap = {
      points: centers,
      resolution,
      numRegions: centers.length,
      numTriangles: (delaunay.triangles.length / 3) | 0,
      numEdges: (delaunay.halfedges.filter((h) => h >= 0).length / 2) | 0,
      halfedges: delaunay.halfedges,
      triangles: delaunay.triangles,
      delaunay,
    };

    const moistures = this.genMoistures(baseMap, moistureWavelength, input.scale);
    const elevations = this.genElevations(
      baseMap,
      input.seaLevel,
      coastWavelength,
      mountainWavelength,
      oceanWavelength,
      input.scale
    );

    return { ...baseMap, elevations, moistures, rainfall };
  }

  private genMoistures(
    baseMap: BaseMap,
    moistureWavelength: number,
    scale: number
  ): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const zoom = scaleZoom(scale);

    const out = new Float32Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
      const nx = (points[r].x / resolution - 0.5) * zoom + MOISTURE_NOISE_OFFSET;
      const ny = (points[r].y / resolution - 0.5) * zoom + MOISTURE_NOISE_OFFSET;
      const raw = fbm(
        this.noise2D,
        nx,
        ny,
        moistureWavelength,
        MOISTURE.AMPLITUDE,
        FRACTAL.OCTAVES,
        FRACTAL.GAIN,
        FRACTAL.LACUNARITY
      );
      const m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw);
      out[r] = this.applyContrast(m, MOISTURE.CONTRAST);
    }

    printSection("MOISTURE SETTINGS", {
      key: "moistureWavelength",
      value: moistureWavelength,
    });
    return out;
  }

  private genElevations(
    baseMap: BaseMap,
    seaLevel: number,
    coastWavelength: number,
    mountainWavelength: number,
    oceanWavelength: number,
    scale: number
  ): Float32Array {
    const { points, numRegions, resolution } = baseMap;
    const elevationContrast = lerp(CONTRAST[0], CONTRAST[1], seaLevel);

    const zoom = scaleZoom(scale);
    const out = new Float32Array(numRegions);
    for (let r = 0; r < numRegions; r++) {
      const x = lerp(-0.5, 0.5, points[r].x / resolution) * zoom;
      const y = lerp(-0.5, 0.5, points[r].y / resolution) * zoom;
      const elev = this.elevationCalc.elevationAt(
        x,
        y,
        coastWavelength,
        mountainWavelength,
        oceanWavelength
      );
      out[r] = this.applyContrast(elev, elevationContrast);
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
