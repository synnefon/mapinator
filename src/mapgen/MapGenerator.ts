import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { Biome } from "../common/biomes";
import type { MapGenSettings } from "../common/config";
import type { BaseMap, Map } from "../common/map";
import { makeRNG } from "../common/random";
import { BiomeManager } from "../renderer/BiomeManager";
import { PointGenerator } from "./PointGenerator";

export class MapGenerator {
    private noise2D: NoiseFunction2D;
    private pointGenerator: PointGenerator;

    public constructor(seed: string) {
        this.noise2D = createNoise2D(makeRNG(seed));
        this.pointGenerator = new PointGenerator(seed);
    }

    public reSeed(seed: string) {
        this.noise2D = createNoise2D(makeRNG(seed));
        this.pointGenerator = new PointGenerator(seed);
    }

    public generateMap(settings: MapGenSettings): Map {
        settings = {
            ...settings,
            wavelength: settings.wavelength + 0.2,
        }
        const { resolution } = settings;

        const { centers, delaunay } = this.pointGenerator.genPoints(settings);

        const baseMap: BaseMap = {
            points: centers,
            resolution: resolution,
            numRegions: centers.length,
            numTriangles: delaunay.halfedges.length / 3,
            numEdges: delaunay.halfedges.length,
            halfedges: delaunay.halfedges,
            triangles: delaunay.triangles,
        }

        const elevations = this.genElevations(baseMap, settings);
        const moistures = this.genMoistures(baseMap, settings);
        const biomes = this.calcBiomes(baseMap, elevations, moistures, settings);

        const map: Map = {
            ...baseMap,
            elevations,
            moistures,
            biomes,
        }

        return map;
    }

    private calcBiomes(
        baseMap: BaseMap,
        elevations: number[],
        moistures: number[],
        settings: MapGenSettings
    ): Biome[] {
        const { numRegions } = baseMap;

        const biomeManager = new BiomeManager(settings.rainfall, settings.seaLevel, settings.colorScheme);
        const biomes: Biome[] = [];
        for (let r = 0; r < numRegions; r++) {
            biomes.push(biomeManager.getBiome(elevations[r], moistures[r]))
        }
        return biomes;
    }

    private genMoistures(baseMap: BaseMap, settings: MapGenSettings): number[] {
        const wavelength = settings.wavelength;
        const { points, numRegions } = baseMap;
        let moisture = [];
        for (let r = 0; r < numRegions; r++) {
            const nx = points[r].x / baseMap.resolution - 1 / 2;
            const ny = points[r].y / baseMap.resolution - 1 / 2;
            const m = (1 + this.noise2D(nx / wavelength, ny / wavelength)) / 2;
            // Clamp into [0,1]
            moisture[r] = Math.max(0, Math.min(1, m));
        }
        return moisture;
    }

    private genElevations(baseMap: BaseMap, settings: MapGenSettings): number[] {
        const { wavelength, edgeCurve, elevationContrast = 0.5 } = settings;
        const shatter = 1 - settings.shatter;
        const minExp = 0.5;
        const maxExp = 3.0;
        const edgeExp = minExp + (maxExp - minExp) * edgeCurve;

        const { points, numRegions, resolution } = baseMap;
        const elevations: number[] = new Array(numRegions);

        const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        // 0 -> flat, 0.5 -> identity, 1 -> max contrast
        const applyElevationContrast = (e: number, c: number) => {
            const u = 2 * e - 1; // shift to [-1,1]

            // Map c ∈ [0,1] into a gamma curve that’s symmetric around c=0.5
            // 0.5 = gamma=1 (no change)
            // 1.0 = gamma<1 (boost contrast)
            // 0.0 = gamma>1 (flatten)
            const gamma =
                c < 0.5
                    ? lerp(3.0, 1.0, c / 0.5) // flatten side
                    : lerp(1.0, 0.2, (c - 0.5) / 0.5); // contrast side

            const uMod = Math.sign(u) * Math.pow(Math.abs(u), gamma);
            return clamp((uMod + 1) / 2);
        };

        for (let r = 0; r < numRegions; r++) {
            const nx = points[r].x / resolution - 0.5;
            const ny = points[r].y / resolution - 0.5;

            let e =
                1 / 3 +
                this.noise2D(nx / wavelength, ny / wavelength) / 2 +
                this.noise2D((2 * nx) / wavelength, (2 * ny) / wavelength) / 3;

            let d = 2 * Math.max(Math.abs(nx), Math.abs(ny));
            d = Math.pow(d, edgeExp);

            const shatterMasked = (1 + e - d) / 2;
            e = lerp(e, shatterMasked, clamp(shatter));

            e = applyElevationContrast(clamp(e), elevationContrast);
            elevations[r] = clamp(e);
        }

        return elevations;
    }


}