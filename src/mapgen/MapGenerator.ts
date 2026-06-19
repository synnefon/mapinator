import { geoVoronoi } from "d3-geo-voronoi";
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { GlobeCell, GlobeMap, Vec3 } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  FEATURE_DETAIL,
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
import {
  dot,
  fibonacciPositions,
  fibonacciSphere,
  lonLatToVec3,
  vec3ToLonLat,
} from "./Sphere";

// Decorrelate the moisture / ice noise from the elevation field.
const MOISTURE_NOISE_OFFSET = 31.7;
const ICE_NOISE_OFFSET = 53.1;

// Midpoint of the FEATURE_DETAIL ("erosion") amplitude, so dividing by it gives a
// ~1-centered factor: moisture swings more in rugged regions, less in calm ones.
const FEATURE_DETAIL_MID =
  (FEATURE_DETAIL.AMPLITUDE[0] + FEATURE_DETAIL.AMPLITUDE[1]) / 2;

// The global mesh (sites + cell rings) depends only on point count, so a handful
// of resolutions stay cached and are reused across seeds. The terrain is a
// continuous, seeded function of position; the mesh just samples it.
const MESH_CACHE_CAP = 4;

// Global Fibonacci point sets (for local patches) cached by point count.
const GLOBE_POSITIONS_CACHE_CAP = 4;

// Local-patch cells beyond this fraction of the cap are padding (their Voronoi
// cells are unbounded toward the rest of the sphere) — kept off-screen, dropped.
const LOCAL_KEEP_FRACTION = 0.85;

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

type MeshCell = { site: Vec3; ring: Vec3[] };

// Per-seed dials shared by the global mesh and every local patch, so a zoomed-in
// patch lines up exactly with the same continents/biomes (just finer).
type Flavor = {
  coastWavelength: number;
  mountainWavelength: number;
  moistureWavelength: number;
  oceanWavelength: number;
  rainfall: number;
  iceCapNorth: number;
  iceCapSouth: number;
};

/** Total globe points for a resolution (zoom does not change generation). */
export function globePointCount(resolution: number): number {
  return Math.round(
    lerp(SLIDER_RANGES.POINT_COUNT[0], SLIDER_RANGES.POINT_COUNT[1], resolution)
  );
}

/**
 * Generates a planet's terrain. The global Voronoi mesh depends only on point
 * count, so it's cached and reused across seeds — only per-cell fields recompute.
 * For zoomed-in views, `generateLocalMap` meshes just the visible cap at higher
 * density and layers extra fractal octaves (finer detail, same continents/biomes).
 * Rotation never regenerates (the renderer re-projects); sea level + theme are
 * render-time.
 */
export class MapGenerator {
  private noise3D: NoiseFunction3D;
  private rng: RNG;
  private elevationCalc: ElevationCalculator;
  private seed: string;
  private meshCache = new Map<number, MeshCell[]>();
  private globePositionsCache = new Map<number, Float32Array>();

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

  /** Whole-globe map at the resolution's point count (base octaves). */
  public generateMap(input: MapSettings): GlobeMap {
    const pointCount = globePointCount(input.resolution);
    const flavor = this.sampleFlavor();
    const mesh = this.getMesh(pointCount);
    const cells = mesh.map((cell) => this.buildCell(cell, flavor, 0));

    printSection(
      "GLOBE SETTINGS",
      { key: "pointCount", value: pointCount },
      { key: "cells", value: cells.length },
      { key: "rainfall", value: flavor.rainfall }
    );

    return { cells, rainfall: flavor.rainfall, pointCount };
  }

  /**
   * Dense map of just the visible cap (half-angle around `center`), built from the
   * subset of the global Fibonacci point set (`globalPoints`) that falls in the cap
   * — so cell SHAPES stay stable as you pan (overlapping views share points) rather
   * than re-tessellating. `extraOctaves` layers finer relief/moisture on top. Same
   * seed/dials as the global map, so it's the same world sampled finer.
   */
  public generateLocalMap(
    center: Vec3,
    halfAngle: number,
    globalPoints: number,
    extraOctaves: number
  ): GlobeMap {
    const flavor = this.sampleFlavor();
    const positions = this.getGlobePositions(globalPoints);
    const cosCap = Math.cos(halfAngle);

    // Sites = the global points inside the cap (deterministic by position).
    const sites: Vec3[] = [];
    for (let i = 0; i < globalPoints; i++) {
      const x = positions[3 * i];
      const y = positions[3 * i + 1];
      const z = positions[3 * i + 2];
      if (x * center.x + y * center.y + z * center.z >= cosCap) {
        sites.push({ x, y, z });
      }
    }

    const voronoi = geoVoronoi(sites.map(vec3ToLonLat));
    const keepCos = Math.cos(halfAngle * LOCAL_KEEP_FRACTION);

    const cells: GlobeCell[] = [];
    for (const feature of voronoi.polygons().features) {
      const geometry = feature.geometry;
      if (!geometry || !geometry.coordinates) continue;
      const [siteLon, siteLat] = feature.properties.sitecoordinates;
      const site = lonLatToVec3(siteLon, siteLat);
      if (dot(site, center) < keepCos) continue; // padding ring → off-screen, drop
      const ring = geometry.coordinates[0].map(([lon, lat]) =>
        lonLatToVec3(lon, lat)
      );
      cells.push(this.buildCell({ site, ring }, flavor, extraOctaves));
    }

    return { cells, rainfall: flavor.rainfall, pointCount: cells.length };
  }

  /** Global Fibonacci point positions for a count, cached + reused across patches. */
  private getGlobePositions(n: number): Float32Array {
    const cached = this.globePositionsCache.get(n);
    if (cached) return cached;
    const positions = fibonacciPositions(n);
    this.globePositionsCache.set(n, positions);
    while (this.globePositionsCache.size > GLOBE_POSITIONS_CACHE_CAP) {
      const oldest = this.globePositionsCache.keys().next().value;
      if (oldest === undefined) break;
      this.globePositionsCache.delete(oldest);
    }
    return positions;
  }

  /** Per-seed flavor dials (relief/moisture wavelengths, rainfall, ice caps). */
  private sampleFlavor(): Flavor {
    const flavorRng = makeRNG(this.seed + "-flavor");
    const coastWavelength = sampleDial(COAST.WAVELENGTH, flavorRng);
    const mountainWavelength = sampleDial(MOUNTAIN.WAVELENGTH, flavorRng);
    const moistureWavelength = sampleDial(MOISTURE.WAVELENGTH, flavorRng);
    const rainfall = sampleDial(RAINFALL, flavorRng);
    const oceanWavelength = sampleDial(OCEAN.WAVELENGTH, flavorRng);
    // One shared cap size, with a small per-pole tweak so the two aren't identical.
    const iceExtent = sampleDial(ICE.EXTENT, flavorRng);
    return {
      coastWavelength,
      mountainWavelength,
      moistureWavelength,
      oceanWavelength,
      rainfall,
      iceCapNorth: clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1),
      iceCapSouth: clamp(iceExtent + sampleDial(ICE.ASYMMETRY, flavorRng), 0, 1),
    };
  }

  /** Compute one cell's fields from its mesh geometry. */
  private buildCell(
    { site, ring }: MeshCell,
    flavor: Flavor,
    extraOctaves: number
  ): GlobeCell {
    return {
      site,
      ring,
      elevation: this.elevationCalc.elevationAt(
        site.x,
        site.y,
        site.z,
        flavor.coastWavelength,
        flavor.mountainWavelength,
        flavor.oceanWavelength,
        extraOctaves
      ),
      moisture: this.moistureAt(site, flavor.moistureWavelength, extraOctaves),
      ice: this.iceAt(site, flavor.iceCapNorth, flavor.iceCapSouth),
    };
  }

  /** Build (or reuse) the global spherical Voronoi mesh for a point count. */
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

  /** Moisture in [0,1] at a sphere point; contrast baked in (it's a fixed dial). */
  private moistureAt(
    site: Vec3,
    moistureWavelength: number,
    extraOctaves: number
  ): number {
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE_NOISE_OFFSET,
      site.y + MOISTURE_NOISE_OFFSET,
      site.z + MOISTURE_NOISE_OFFSET,
      moistureWavelength,
      MOISTURE.AMPLITUDE,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    // Modulate the moisture swing by the same FEATURE_DETAIL field as terrain:
    // more wet/dry variation in rugged regions, smoother in calm ones.
    const detail =
      this.elevationCalc.erosionAmplitudeAt(site.x, site.y, site.z) /
      FEATURE_DETAIL_MID;
    const m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw * detail);
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
