// BiomeManager.ts
import {
    Biomes,
    biomeRules,
    type Biome,
    type BiomeKey,
    type BiomeRule,
    type ColorScheme,
} from "../common/biomes";

export class BiomeManager {
    private rainfall: number;   // internal exponent factor
    private seaLevel: number;   // -1..1 (normalized)
    private colorScheme: ColorScheme;
    private EPS = 1e-9;

    public constructor(rainfall: number, seaLevel: number, colorScheme: ColorScheme) {
        if (rainfall < 0 || rainfall > 1 || seaLevel < 0 || seaLevel > 1) {
            throw Error("rainfall & seaLevel must be 0-1");
        }

        // Moisture shaping
        const shaped = this.expCurve(1 - rainfall, 4.1);
        this.rainfall = Math.max(0.01, shaped * 25);

        // Normalize sea level to -1..1
        this.seaLevel = 2.0 * (seaLevel - 0.5);

        this.colorScheme = colorScheme;
    }

    public getBiome(elevation: number, moisture: number): Biome {
        // remap & clamp
        let e = (2.0 * (elevation - 0.5)) - (this.seaLevel - 0.1);
        let m = moisture ** this.rainfall;
        e = Math.max(Math.min(e, 1 - this.EPS), -1);
        m = Math.max(Math.min(m, 1 - this.EPS), -1);

        const rule = this.findMatchingBiomeRule(e, m);
        if (!rule) {
            throw new Error(`unable to find biome for elevation: ${elevation}, moisture: ${moisture}`);
        }
        const key: BiomeKey = rule.biomeKey;
        return Biomes[this.colorScheme][key];
    }

    private findMatchingBiomeRule(elevation: number, moisture: number): BiomeRule | undefined {
        const idx = this.findLastIndex(
            biomeRules,
            (rule) => this.matchesRule(rule, elevation, moisture),
        );
        return idx >= 0 ? biomeRules[idx] : undefined;
    }

    private expCurve(x: number, k: number): number {
        const clamped = Math.max(0, Math.min(1, x));
        return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
    }

    private matchesRule(rule: BiomeRule, elevation: number, moisture: number): boolean {
        return (
            rule.elevation[0] <= elevation &&
            elevation < rule.elevation[1] &&
            rule.moisture[0] <= moisture &&
            moisture < rule.moisture[1]
        );
    }

    private findLastIndex<T>(
        arr: T[],
        predicate: (value: T, index: number, array: T[]) => boolean
    ): number {
        for (let i = arr.length - 1; i >= 0; i--) {
            if (predicate(arr[i], i, arr)) return i;
        }
        return -1;
    }
}
