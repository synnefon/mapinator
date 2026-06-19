import { geoVoronoi } from "d3-geo-voronoi";
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { GlobeCell, GlobeMap, Vec3 } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  FRACTAL,
  ICE,
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

// Decorrelate the moisture / ice noise from the elevation field.
const MOISTURE_NOISE_OFFSET = 31.7;
const ICE_NOISE_OFFSET = 53.1;

// The mesh (sites + cell rings) depends only on point count, so a handful of
// resolutions stay cached and are reused across seeds. The terrain is a continuous,
// seeded function of position; the mesh just samples it (zoom does not change it).
const MESH_CACHE_CAP = 4;

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type MeshCell = { site: Vec3; ring: Vec3[] };

/** Total globe points for a resolution (zoom does not change generation). */
export function globePointCount(resolution: number): number {
  return Math.round(
    lerp(SLIDER_RANGES.POINT_COUNT[0], SLIDER_RANGES.POINT_COUNT[1], resolution)
  );
}

/**
 * Generates a planet's terrain. The spherical Voronoi mesh (Fibonacci points +
 * geoVoronoi) depends only on point count, so it's cached and reused across seeds
 * and zoom — only the per-cell elevation / moisture / ice recompute. Rotation never
 * regenerates (the renderer re-projects); sea level + theme are render-time.
 */
export class MapGenerator {
  private noise3D: NoiseFunction3D;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;
  private seed: string;
  private meshCache = new Map<number, MeshCell[]>();

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
    // Mesh is seed-independent, so it stays cached across reSeed.
  }

  /** Build (or reuse) the spherical Voronoi mesh for a given point count. */
  private getMesh(pointCount: number): MeshCell[] {
    const cached = this.meshCache.get(pointCount);
    if (cached) return cached;

    const sites = fibonacciSphere(pointCount);
    const voronoi = geoVoronoi(sites.map(vec3ToLonLat));
    const mesh: MeshCell[] = [];
    for (const feature of voronoi.polygons().features) {
      const geometry = feature.geometry;
      if (!geometry || !geometry.coordinates) continue; // skip degenerate / Sphere
      const [siteLon, siteLat] = feature.properties.sitecoordinates;
      mesh.push({
        site: lonLatToVec3(siteLon, siteLat),
        ring: geometry.coordinates[0].map(([lon, lat]) => lonLatToVec3(lon, lat)),
      });
    }

    this.meshCache.set(pointCount, mesh);
    while (this.meshCache.size > MESH_CACHE_CAP) {
      const oldest = this.meshCache.keys().next().value;
      if (oldest === undefined) break;
      this.meshCache.delete(oldest);
    }
    return mesh;
  }

  public generateMap(input: MapSettings): GlobeMap {
    const pointCount = globePointCount(input.resolution);

    // Per-seed "flavor" dials (relief/moisture wavelengths, rainfall, ice caps).
    const flavorRng = makeRNG(this.seed + "-flavor");
    const coastWavelength = sampleDial(COAST.WAVELENGTH, flavorRng);
    const mountainWavelength = sampleDial(MOUNTAIN.WAVELENGTH, flavorRng);
    const moistureWavelength = sampleDial(MOISTURE.WAVELENGTH, flavorRng);
    const rainfall = sampleDial(RAINFALL, flavorRng);
    const oceanWavelength = sampleDial(OCEAN.WAVELENGTH, flavorRng);
    // One shared cap size, with a small per-pole tweak so the two aren't identical.
    const iceExtent = sampleDial(ICE.EXTENT, flavorRng);
    const iceCapNorth = clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1);
    const iceCapSouth = clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1);

    const mesh = this.getMesh(pointCount);
    const cells: GlobeCell[] = mesh.map(({ site, ring }) => ({
      site,
      ring,
      elevation: this.elevationCalc.elevationAt(
        site.x,
        site.y,
        site.z,
        coastWavelength,
        mountainWavelength,
        oceanWavelength
      ),
      moisture: this.moistureAt(site, moistureWavelength),
      ice: this.iceAt(site, iceCapNorth, iceCapSouth),
    }));

    printSection(
      "GLOBE SETTINGS",
      { key: "pointCount", value: pointCount },
      { key: "cells", value: cells.length },
      { key: "rainfall", value: rainfall },
      { key: "iceCapNorth", value: iceCapNorth },
      { key: "iceCapSouth", value: iceCapSouth }
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

  /** Polar ice mask in [0,1] (1 = full ice); per-seed cap size + a noisy edge. */
  private iceAt(site: Vec3, capNorth: number, capSouth: number): number {
    const wobble =
      ICE.WOBBLE *
      this.noise3D(
        site.x * ICE.FREQ + ICE_NOISE_OFFSET,
        site.y * ICE.FREQ + ICE_NOISE_OFFSET,
        site.z * ICE.FREQ + ICE_NOISE_OFFSET
      );
    const north = smoothstep(capNorth, capNorth + ICE.EDGE, site.y + wobble);
    const south = smoothstep(capSouth, capSouth + ICE.EDGE, -site.y + wobble);
    return Math.max(north, south);
  }
}
