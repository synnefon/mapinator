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
            // Language.ROMANCE,
            // Language.GERMANIC,
            // Language.SEMITIC,
            // Language.CN,
            // Language.JP,
            // Language.AFRICAN_WEST,
            // Language.AFRICAN_HORN,
            // Language.POLYNESIAN,
            // Language.LATINIC,
            // Language.CELESTIC,
            // Language.INFERNIC,
            // Language.ARCANE,
            // Language.DEEP_SPEECH,
            // Language.GOBLINIC,
            // Language.INFERNO,
            // Language.SIRENIC,
            // Language.OOGA_BOOGA,
            // Language.DWARVISH,
            // Language.HALFLING,
            // Language.NOCTURNIC,
            // Language.DERPTONGUE,
            // Language.TOADISH,
            // Language.BANANAIC,
            // Language.LYRICIAN,
            // Language.ANGLISHIC,
            Language.NEW_ANGLISHIC,
        ];
        const lang = langs[Math.floor(this.rng() * langs.length)];
        console.log(`chosen language: ${lang}`)
        return lang;
    }

    private pickSuffix(f: Language): string {
        const arr = languageConfigs[f].suffixes;
        return arr[Math.floor(this.rng() * arr.length)];
    }

    private buildStem(syllables: number, language: Language): string {
        const cfg = languageConfigs[language];
        const out: string[] = [];

        const clamp = (x: number, lo = 0, hi = 0.95) => Math.min(hi, Math.max(lo, x));

        const pickCoda = (isLast: boolean, nextOnset: string): string => {
            const base = cfg.codaChance ?? 0;
            const chance = clamp(base * (isLast ? 1.2 : 0.6));
            if (this.rng() >= chance) return "";

            const picked = this.pick(cfg.codas) || "";
            if (!picked) return "";

            const makesCCC =
                !isLast &&
                nextOnset &&
                this.endsWithConsonant(picked) &&
                this.startsWithConsonant(nextOnset);

            if (makesCCC && this.rng() < 0.60) return ""; // drop 60% to avoid ugly clusters
            return picked;
        };

        let nextOnset = this.pick(cfg.onsets) || "";

        for (let i = 0; i < syllables; i++) {
            const isLast = i === syllables - 1;
            const onset = nextOnset;
            const vowel = this.pick(cfg.vowels) || "";
            nextOnset = isLast ? "" : (this.pick(cfg.onsets) || "");

            const coda = pickCoda(isLast, nextOnset);
            out.push(onset, vowel, coda);
        }

        return out.join("");
    }


    // ----- helpers -----
    private isVowel(ch: string): boolean {
        return /^[aeiou]$/i.test(ch);
    }
    private startsWithConsonant(s: string): boolean {
        const first = s.charAt(0);
        // treat non-letters (apostrophes, etc.) as consonantish separators
        return /^[a-z]/i.test(first) ? !this.isVowel(first) : true;
    }
    private endsWithConsonant(s: string): boolean {
        const last = s.slice(-1);
        return /^[a-z]/i.test(last) ? !this.isVowel(last) : true;
    }


    // private buildStem(
    //     syllables: number,
    //     language: Language
    // ): string {
    //     const langConfig = languageConfigs[language];
    //     let out = "";
    //     for (let i = 0; i < syllables; i++) {
    //         out += this.pick(langConfig.onsets) + this.pick(langConfig.vowels);
    //         if (this.rng() < langConfig.codaChance) out += this.pick(langConfig.codas);
    //     }
    //     return out;
    // }

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
