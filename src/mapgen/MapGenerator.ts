import seedrandom from "seedrandom";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import type { Biome } from "../common/biomes";
import type { MapGenSettings } from "../common/config";
import type { BaseMap, Map } from "../common/map";
import { BiomeManager } from "../renderer/BiomeManager";
import { PointGenerator } from "./PointGenerator";

export class MapGenerator {
    private noise2D: NoiseFunction2D;
    private pointGenerator: PointGenerator;

    public constructor() {
        const rng = seedrandom("my-seed-" + Date.now());
        this.noise2D = createNoise2D(rng);
        this.pointGenerator = new PointGenerator();
    }

    public reSeed() {
        const rng = seedrandom("my-seed-" + Date.now());
        this.noise2D = createNoise2D(rng);
    }

    public generateMap(settings: MapGenSettings): Map {
        const { gridSize } = settings;

        const { centers, delaunay } = this.pointGenerator.genPoints(settings);

        const baseMap: BaseMap = {
            points: centers,
            gridsize: gridSize,
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

        const biomeManager = new BiomeManager(settings.rainfall, settings.seaLevel);
        const biomes: Biome[] = [];
        for (let r = 0; r < numRegions; r++) {
            biomes.push(biomeManager.getBiome(elevations[r], moistures[r]))
        }
        return biomes;
    }

    private genMoistures(baseMap: BaseMap, settings: MapGenSettings): number[] {
        const { wavelength } = settings;
        const { points, numRegions } = baseMap;
        let moisture = [];
        for (let r = 0; r < numRegions; r++) {
            const nx = points[r].x / baseMap.gridsize - 1 / 2;
            const ny = points[r].y / baseMap.gridsize - 1 / 2;
            const m = (1 + this.noise2D(nx / wavelength, ny / wavelength)) / 2;
            // Clamp into [0,1]
            moisture[r] = Math.max(0, Math.min(1, m));
        }
        return moisture;
    }

    private genElevations(baseMap: BaseMap, settings: MapGenSettings): number[] {
        const { wavelength, edgeCurve } = settings;
        const shatter = 1 - settings.shatter;
        const minExp = 0.5;
        const maxExp = 3.0;
        const edgeExp = minExp + (maxExp - minExp) * edgeCurve;

        const { points, numRegions, gridsize } = baseMap;
        const elevation: number[] = new Array(numRegions);

        const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        for (let r = 0; r < numRegions; r++) {
            const nx = points[r].x / gridsize - 0.5;
            const ny = points[r].y / gridsize - 0.5;

            // base noise (octaves)
            let e =
                1 / 3 +
                this.noise2D(nx / wavelength, ny / wavelength) / 2 +
                this.noise2D((2 * nx) / wavelength, (2 * ny) / wavelength) / 3;

            // edge distance (0 center → 1 border), shaped by edgeExp
            let d = 2 * Math.max(Math.abs(nx), Math.abs(ny));
            d = Math.pow(d, edgeExp);

            // island-style mask (lowers edges)
            const shatterMasked = (1 + e - d) / 2;

            // blend raw noise vs masked by 'shatter' (your inverted control)
            e = lerp(e, shatterMasked, clamp(shatter));

            elevation[r] = clamp(e);
        }

        return elevation;
    }
}