import { Language, languageConfigs } from "../common/language";
import { makeRNG, type RNG } from "../common/random";


export interface CountryGenOptions {
    seed?: string | number;
    lang?: Language;
    syllables?: [min: number, max: number];
    allowDiacritics?: boolean;
    forceSuffix?: string;
    useArticle?: boolean;
}

export class NameGenerator {
    private rng: RNG;

    constructor(seed: string) {
        this.rng = makeRNG(seed);
    }

    public reSeed(seed: string) {
        this.rng = makeRNG(seed);
    }

    /** Generate a single country name */
    public generate(opts: CountryGenOptions = {}): string {
        const lang = opts.lang ?? this.pickLanguage();
        const [minSyl, maxSyl] = opts.syllables ?? [1, 2];
        const coreSylCount = this.randInt(minSyl, maxSyl);
        const suffix = (opts.forceSuffix ?? this.pickSuffix(lang)).toLowerCase();

        let stem = this.buildStem(coreSylCount, lang);
        stem = this.tidyStemVsSuffix(stem, suffix);

        let name = this.titleCase(stem + suffix);
        return name;
    }

    // ---------------- helpers ----------------

    private pickLanguage(): Language {
        const langs: Language[] = [
            Language.ROMANCE,
            Language.GERMANIC,
            Language.SLAVIC,
            Language.SEMITIC,
            Language.EAST_ASIAN_CN,
            Language.EAST_ASIAN_JP,
            Language.EAST_ASIAN_KR,
            Language.AFRICAN_WEST,
            Language.AFRICAN_HORN,
            Language.POLYNESIAN,
        ];
        return langs[Math.floor(this.rng() * langs.length)];
    }

    private pickSuffix(f: Language): string {
        const arr = languageConfigs[f].suffixes;
        return arr[Math.floor(this.rng() * arr.length)];
    }

    private buildStem(
        syllables: number,
        language: Language
    ): string {
        const langConfig = languageConfigs[language];
        let out = "";
        for (let i = 0; i < syllables; i++) {
            out += this.pick(langConfig.onsets) + this.pick(langConfig.vowels);
            if (this.rng() < langConfig.codaChance) out += this.pick(langConfig.codas);
        }
        return out;
    }

    private tidyStemVsSuffix(stem: string, suffix: string): string {
        if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suffix)) {
            return stem.slice(0, -1);
        }
        return stem;
    }

    private titleCase(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    private pick<T>(arr: T[]): T {
        return arr[Math.floor(this.rng() * arr.length)];
    }

    private randInt(min: number, max: number): number {
        return Math.floor(this.rng() * (max - min + 1)) + min;
    }
}
