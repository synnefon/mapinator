import { geoVoronoi } from "d3-geo-voronoi";
import { createNoise3D, type NoiseFunction3D } from "simplex-noise";
import type { GlobeMap, MeshCell, Vec3 } from "../common/map";
import { printSection } from "../common/printUtils";
import { makeRNG, type RNG } from "../common/random";
import {
  COAST,
  FEATURE_DETAIL_MID,
  FRACTAL,
  ICE,
  INVARIANTS,
  MESH,
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
import { capDelaunayMesh } from "./CapMesh";
import {
  fibonacciCapSites,
  fibonacciSphere,
  lonLatToVec3,
  vec3ToLonLat,
} from "./Sphere";

// Phase offset so the ice-edge ruffle noise doesn't line up with the elevation field.
const ICE_RUFFLE_OFFSET = 53.1;

const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

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
    const map = this.packMesh(mesh, flavor, 0, pointCount);

    printSection(
      "GLOBE SETTINGS",
      { key: "pointCount", value: pointCount },
      { key: "cells", value: map.cellCount },
      { key: "rainfall", value: flavor.rainfall }
    );

    return map;
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
    // Sites = the global points inside the cap (deterministic by position), found by
    // scanning only the cap's index band rather than all `globalPoints`.
    const sites = fibonacciCapSites(center, halfAngle, globalPoints);

    // Mesh the cap with stereographic + planar Delaunay (exact geodesic Voronoi, far
    // faster than spherical geoVoronoi); rim/unbounded cells are dropped inside.
    const keepCos = Math.cos(halfAngle * MESH.LOCAL_KEEP_FRACTION);
    const mesh = capDelaunayMesh(sites, center, keepCos);

    // Cap (inset) the renderer uses to skip global base cells hidden by this patch.
    const cap = {
      center,
      cosKeep: Math.cos(
        Math.max(
          0,
          halfAngle * MESH.LOCAL_KEEP_FRACTION -
            (MESH.OCCLUSION_MARGIN_DEG * Math.PI) / 180
        )
      ),
    };

    return this.packMesh(mesh, flavor, extraOctaves, mesh.length, cap);
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

  /**
   * Pack a mesh (sites + rings) and its computed fields into the flat typed-array
   * GlobeMap in a single pass: copy geometry into shared buffers and sample
   * elevation/moisture/ice per cell.
   */
  private packMesh(
    cells: MeshCell[],
    flavor: Flavor,
    extraOctaves: number,
    pointCount: number,
    cap?: { center: Vec3; cosKeep: number }
  ): GlobeMap {
    const n = cells.length;
    let totalVerts = 0;
    for (let i = 0; i < n; i++) totalVerts += cells[i].ring.length;

    const sites = new Float32Array(n * 3);
    const ringOffsets = new Uint32Array(n + 1);
    const ringVerts = new Float32Array(totalVerts * 3);
    const elevation = new Float32Array(n);
    const moisture = new Float32Array(n);
    const ice = new Float32Array(n);

    let vo = 0;
    let maxChord2 = 0; // largest squared site→ring-vert distance (cull radius)
    for (let i = 0; i < n; i++) {
      const { site, ring } = cells[i];
      sites[3 * i] = site.x;
      sites[3 * i + 1] = site.y;
      sites[3 * i + 2] = site.z;
      ringOffsets[i] = vo;
      for (let k = 0; k < ring.length; k++) {
        const rx = ring[k].x;
        const ry = ring[k].y;
        const rz = ring[k].z;
        ringVerts[3 * vo] = rx;
        ringVerts[3 * vo + 1] = ry;
        ringVerts[3 * vo + 2] = rz;
        const dx = rx - site.x;
        const dy = ry - site.y;
        const dz = rz - site.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxChord2) maxChord2 = d2;
        vo++;
      }
      // Sampled once here and shared: it scales the terrain relief AND modulates
      // the moisture swing, so computing it per-cell avoids a duplicate noise lookup.
      const erosion = this.elevationCalc.erosionAmplitudeAt(site.x, site.y, site.z);
      elevation[i] = this.elevationCalc.elevationAt(
        site.x,
        site.y,
        site.z,
        flavor.coastWavelength,
        flavor.mountainWavelength,
        flavor.oceanWavelength,
        extraOctaves,
        erosion
      );
      moisture[i] = this.moistureAt(
        site,
        flavor.moistureWavelength,
        extraOctaves,
        erosion
      );
      ice[i] = this.iceAt(site, elevation[i], flavor.iceCapNorth, flavor.iceCapSouth);
    }
    ringOffsets[n] = vo;

    return {
      cellCount: n,
      sites,
      ringOffsets,
      ringVerts,
      elevation,
      moisture,
      ice,
      rainfall: flavor.rainfall,
      pointCount,
      maxRingRadius: Math.sqrt(maxChord2),
      cap,
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
    while (this.meshCache.size > MESH.CACHE_CAP) {
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
    extraOctaves: number,
    erosion: number
  ): number {
    const raw = fbm3(
      this.noise3D,
      site.x + MOISTURE.NOISE_OFFSET,
      site.y + MOISTURE.NOISE_OFFSET,
      site.z + MOISTURE.NOISE_OFFSET,
      moistureWavelength,
      MOISTURE.AMPLITUDE,
      FRACTAL.OCTAVES + extraOctaves,
      FRACTAL.GAIN,
      FRACTAL.LACUNARITY
    );
    // Modulate the moisture swing by the same FEATURE_DETAIL field as terrain:
    // more wet/dry variation in rugged regions, smoother in calm ones.
    const detail = erosion / FEATURE_DETAIL_MID;
    const m = clamp(INVARIANTS.NEUTRAL_CENTER_POINT + raw * detail);
    return applyContrast(m, MOISTURE.CONTRAST);
  }

  /**
   * Polar iciness in [0,1], blended into the terrain downstream. Snow on LAND ONLY for
   * now (open water never ices). On land it's snow poleward of the snow line (the per-seed
   * cap minus LAND_BONUS), ramping down over EDGE on the equatorward side; the line is
   * ruffled by noise so the cap isn't a clean circle. Per pole (ASYMMETRY).
   */
  private iceAt(
    site: Vec3,
    elevation: number,
    capNorth: number,
    capSouth: number
  ): number {
    // Open water never ices (for now); only land above the elevation midpoint snows.
    if (elevation <= INVARIANTS.NEUTRAL_CENTER_POINT) return 0;
    // Ruffle the snow line: a base wave (slightly lopsided, asymmetrical outline) plus a
    // finer octave at 3× (ragged edge). Only the edge moves; the interior stays solid.
    const f = ICE.RUFFLE_FREQ;
    const o = ICE_RUFFLE_OFFSET;
    const ruffle =
      ICE.RUFFLE *
      (this.noise3D(site.x * f + o, site.y * f + o, site.z * f + o) +
        0.5 *
          this.noise3D(site.x * f * 3 + o, site.y * f * 3 + o, site.z * f * 3 + o));
    const lineN = capNorth - ICE.LAND_BONUS;
    const lineS = capSouth - ICE.LAND_BONUS;
    const north = smoothstep(lineN - ICE.EDGE, lineN, site.y + ruffle);
    const south = smoothstep(lineS - ICE.EDGE, lineS, -site.y + ruffle);
    return Math.max(north, south);
  }
}
