import { type Language, languageConfigs, Languages } from "../common/language";
import { makeRNG, randomChoice, type RNG } from "../common/random";

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
        const coreSylCount = randomChoice(opts.syllables ?? [1, 2], this.rng);
        const suffix = (opts.forceSuffix ?? this.pickSuffix(lang)).toLowerCase();
        const MAX_RETRIES = 8;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const stem = this.tidyStemVsSuffix(this.buildStem(coreSylCount, lang), suffix);
            const raw = stem + suffix;

            if (this.isPronounceable(raw, lang)) return this.titleCase(raw);

            const softened = this.softenClusters(raw, lang);
            if (this.isPronounceable(softened, lang)) return this.titleCase(softened);

            const vowelFixed = this.softenVowels(raw, lang);
            if (this.isPronounceable(vowelFixed, lang)) return this.titleCase(vowelFixed);

            if (attempt === MAX_RETRIES - 1) return this.titleCase(vowelFixed || softened || raw);
        }
        return "";
    }

    private softenClusters(s: string, language: Language): string {
        const cfg = languageConfigs[language];
        const clusterLinker = cfg.clusterLinker;

        const allowedOnsets = new Set((cfg.onsets || []).map(x => x.toLowerCase()));
        const allowedCodas = new Set((cfg.codas || []).map(x => x.toLowerCase()));

        const parts = s.split(/([\s’'ʻ`\-_.]+)/);
        for (let pi = 0; pi < parts.length; pi++) {
            const token = parts[pi];
            if (/^[\s’'ʻ`\-_.]+$/.test(token)) continue;

            const digraphed = token.replace(/ch|sh|zh|ts|tz|wh|ng|kh|gh|ph|th|dh|qu/gi, m => m[0].toUpperCase());
            const letters = digraphed.replace(/[^a-zA-Z]/g, "");
            const raw = letters.replace(/[A-Z]/g, m => m.toLowerCase() + "_");
            const runs = raw.match(/[^aeiouy_]+/g) || [];

            let bestStart = -1, bestLen = 0, pos = 0;
            for (const r of runs) {
                const cl = r.replace(/_/g, "");
                const start = raw.indexOf(r, pos);
                const end = start + r.length; pos = end;
                if (cl.length <= 1) continue;

                const isStart = start === 0;
                const isEnd = end === raw.length;
                if (isStart && allowedOnsets.has(cl)) continue;
                if (isEnd && allowedCodas.has(cl)) continue;

                let ok = false;
                for (let k = 1; k < cl.length; k++) {
                    if (allowedCodas.has(cl.slice(0, k)) && allowedOnsets.has(cl.slice(k))) { ok = true; break; }
                }
                if (!ok && cl.length > bestLen) { bestLen = cl.length; bestStart = start; }
            }

            if (bestStart >= 0) {
                const idx = bestStart + 1;
                parts[pi] = token.slice(0, idx) + clusterLinker + token.slice(idx);
                break;
            }
        }
        return parts.join("");
    }

    private softenVowels(s: string, language: Language): string {
        const cfg = languageConfigs[language];
        const vowelLinker = cfg.vowelLinker;
        const chars = s.split("");

        let run = 0;
        for (let i = 0; i < chars.length; i++) {
            if (this.isVowel(chars[i])) {
                run++;
                if (run >= (cfg.maxVowelRun)) {
                    chars.splice(i, 0, vowelLinker);
                    break;
                }
            } else run = 0;
        }
        return chars.join("");
    }

    private estimateSyllables(s: string, treatYAsVowel = true): number {
        const vowels = treatYAsVowel ? "aeiouy" : "aeiou";
        // count vowel groups; okina/apostrophes force a break
        const cleaned = s.toLowerCase().normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "") // strip diacritics
            .replace(/[’'ʻ`]/g, " ");        // splitters
        const groups = cleaned.match(new RegExp(`[${vowels}]+`, "g")) || [];
        return groups.length;
    }


    private isPronounceable(s: string, language: Language): boolean {
        const cfg = languageConfigs[language];

        // --- normalize & collapse digraphs (count as single cons) ---
        const digraphs = /ch|sh|zh|ts|tz|wh|ng|kh|gh|ph|th|dh|qu/gi;
        const w = s
            .toLowerCase()
            .replace(/[’'ʻ`\-_.]/g, " ")                // boundaries
            .replace(digraphs, m => m[0].toUpperCase()); // mark as single symbol
        const letters = w.replace(/[^a-zA-Z]/g, "");
        if (!letters) return false;

        const V = /[aeiouy]/i;
        if (!V.test(letters)) return false;           // needs a vowel

        // --- quick metrics (runs & ratio) ---
        const plain = letters.replace(/[A-Z]/g, m => m.toLowerCase()); // remove markers
        const consRuns = (plain.match(/[^aeiouy]+/g) || []).map(s => s.length);
        const vowelRuns = (plain.match(/[aeiouy]+/g) || []).map(s => s.length);
        const maxConsRun = Math.max(0, ...consRuns);
        const maxVowelRun = Math.max(0, ...vowelRuns);
        const vowelRatio = (plain.match(/[aeiouy]/g) || []).length / plain.length;

        // pull per-language knobs (with fallbacks)
        const maxConsAllowed = cfg.maxConsRun;
        const maxVowelAllowed = cfg.maxVowelRun;
        const minVowelRatio = cfg.minVowelRatio;

        if (maxConsRun > maxConsAllowed) return false;
        if (maxVowelRun > maxVowelAllowed) return false;
        if (vowelRatio < minVowelRatio) return false;

        // --- cluster sanity against allowed onset/coda inventory ---
        const allowedOnsets = new Set((cfg.onsets || []).map(x => x.toLowerCase()));
        const allowedCodas = new Set((cfg.codas || []).map(x => x.toLowerCase()));

        // scan each “word” for illegal interior clusters
        for (const word of w.split(/\s+/).filter(Boolean)) {
            const raw = word.replace(/[A-Z]/g, m => m.toLowerCase() + "_"); // mark digraph slots
            const clusters = raw.match(/[^aeiouy_]+/g) || [];
            let cursor = 0;
            for (const token of clusters) {
                const cl = token.replace(/_/g, "");
                if (cl.length <= 1) { cursor += token.length; continue; }

                const start = raw.indexOf(token, cursor);
                const end = start + token.length;
                cursor = end;

                const isStart = start === 0;
                const isEnd = end === raw.length;

                if (isStart && allowedOnsets.has(cl)) continue;
                if (isEnd && allowedCodas.has(cl)) continue;

                // interior: allow if splittable into [coda][onset]
                let ok = false;
                for (let k = 1; k < cl.length; k++) {
                    if (allowedCodas.has(cl.slice(0, k)) && allowedOnsets.has(cl.slice(k))) { ok = true; break; }
                }
                if (!ok) return false;
            }
        }

        // syllable sanity
        const syl = this.estimateSyllables(s, cfg.treatYAsVowel);
        if (cfg.minSyllables && syl < cfg.minSyllables) return false;
        if (cfg.maxSyllables && syl > cfg.maxSyllables) return false;

        return true;
    }


    // ---------------- helpers ----------------

    private pickLanguage(): Language {
        const lang = randomChoice(Languages as unknown as string[], this.rng);
        console.log(`chosen language: ${lang}`)
        return lang as Language;
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
            const base = cfg.codaChance;
            const chance = clamp(base * (isLast ? 1.2 : 0.6));
            if (this.rng() >= chance) return "";

            const picked = randomChoice(cfg.codas, this.rng) || "";
            if (!picked) return "";

            const makesCCC =
                !isLast &&
                nextOnset &&
                this.endsWithConsonant(picked) &&
                this.startsWithConsonant(nextOnset);

            if (makesCCC && this.rng() < 0.60) return ""; // drop 60% to avoid ugly clusters
            return picked;
        };

        const pickMedial = (): string => {
            const arr = (cfg as any).medials as string[] | undefined;
            const chance = (cfg as any).medialMorphChance as number | undefined;
            if (!arr || !arr.length || !chance) return "";
            return this.rng() < chance ? (randomChoice(arr, this.rng) || "") : "";
        };

        let nextOnset = randomChoice(cfg.onsets, this.rng) || "";

        for (let i = 0; i < syllables; i++) {
            const isLast = i === syllables - 1;
            const onset = nextOnset;
            const vowel = randomChoice(cfg.vowels, this.rng) || "";
            nextOnset = isLast ? "" : (randomChoice(cfg.onsets, this.rng) || "");
            const coda = pickCoda(isLast, nextOnset);

            // push the syllable
            out.push(onset, vowel, coda);

            // maybe inject a medial BETWEEN syllables
            if (!isLast) {
                const medial = pickMedial();
                if (medial) {
                    const prev = out.join("");
                    const joined = this.smartJoin(prev, medial);
                    // replace the existing buffer with the smoothed version
                    out.length = 0;
                    out.push(joined);
                }
            }
        }

        return out.join("");
    }

    // Smooth boundary between 'left' and 'right' chunks.
    // - trims double vowels at seam (…a + ariki -> …ariki)
    // - softens harsh CC seams a bit by inserting a light 'a' sometimes
    private smartJoin(left: string, right: string): string {
        if (!right) return left;
        if (!left) return right;

        const L = left.slice(-1);
        const R = right.charAt(0);

        // vowel-vowel seam: drop the leftmost final vowel
        if (this.isVowel(L) && this.isVowel(R)) {
            return left.slice(0, -1) + right;
        }

        // consonant-consonant seam: occasionally insert a light linker 'a'
        // (kept low so languages with allowed clusters still shine)
        if (!this.isVowel(L) && !this.isVowel(R)) {
            if (this.rng() < 0.35) return left + "a" + right;
        }

        return left + right;
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

    private tidyStemVsSuffix(stem: string, suffix: string): string {
        if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suffix)) {
            return stem.slice(0, -1);
        }
        return stem;
    }

    private titleCase(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
}
