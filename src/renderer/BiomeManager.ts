import type { Biome, BiomeRule } from "../common/biomes";
import { biomeRules, Biomes } from "../common/biomes";

export class BiomeManager {
    private rainfall: number; // 0-1
    private seaLevel: number; // 0-1

    public constructor(rainfall: number, seaLevel: number) {
        if (rainfall < 0 || rainfall > 1 || seaLevel < 0 || seaLevel > 1) {
            throw Error("rainfall & seaLevel must be 0-1");
        }

        rainfall = this.expCurve(1 - rainfall, 4.1)
        this.rainfall = Math.max(0.01, rainfall * 25);

        this.seaLevel = 2.0 * (seaLevel - 0.5); // -1 to 1
    }

    public getBiome(elevation: number, moisture: number): Biome {
        let e = (2.0 * (elevation - 0.5)) - (this.seaLevel - 0.1);
        let m = moisture ** this.rainfall;

        // to make some checks work
        e = Math.max(Math.min(e, 1 - this.EPS), -1);
        m = Math.max(Math.min(m, 1 - this.EPS), -1);

        const biomeRule = this.findMatchingBiomeRule(e, m);
        if (!biomeRule) {
            throw new Error(`unable to find biome for elevation: ${elevation}, moisture: ${moisture}`);
        };

        return biomeRule.biome;
    };

    private findMatchingBiomeRule(elevation: number, moisture: number): BiomeRule {
        const ruleIdx = this.findLastIndex(
            biomeRules,
            (rule: BiomeRule, _i: number, _r: BiomeRule[]) => this.matchesRule(rule, elevation, moisture),
        );

        return biomeRules[ruleIdx];
    }

    public isOcean(elevation: number) {
        const oceanRuleIdx = this.findLastIndex(biomeRules, r =>
            r.biome.name === Biomes.OCEAN.name
        );
        const oceanRule = biomeRules[oceanRuleIdx];
        return oceanRule.elevation[1] >= elevation;
    }

    private expCurve(x: number, k: number): number {
        // Clamp input
        const clamped = Math.max(0, Math.min(1, x));

        // Exponential remap
        return (Math.exp(k * clamped) - 1) / (Math.exp(k) - 1);
    }

    private matchesRule(rule: BiomeRule, elevation: number, moisture: number): boolean {
        return rule.elevation[0] <= elevation &&
            rule.elevation[1] > elevation &&
            rule.moisture[0] <= moisture &&
            rule.moisture[1] > moisture
    }

    private EPS = 1e-9;

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