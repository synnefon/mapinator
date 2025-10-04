// random-country.ts
type RNG = () => number;

export interface CountryNameOptions {
    seed?: number;           // deterministic output
    allowDiacritics?: boolean;
}

// Phonotactics: consonant/vowel clusters common across many languages.
// These are RULE PARTS, not country names.
const C = [
    "b", "c", "ch", "d", "f", "g", "gh", "h", "j", "k", "kh", "l", "m", "n", "p", "ph", "q", "r", "rh", "s", "sh", "t", "th", "v", "w", "x", "y", "z", "zh",
    "br", "cr", "dr", "fr", "gr", "kr", "pr", "tr", "vr", "zr", "sk", "st", "sp", "str", "scr", "spl", "gl", "pl", "cl", "fl", "sl", "sm", "sn", "sw"
];
const V = ["a", "e", "i", "o", "u", "ae", "ai", "au", "ea", "ei", "ia", "ie", "io", "oa", "oi", "ou", "ua", "ue", "ui"];

// Simple syllable blueprints
const TEMPLATES = [
    "CV", "CVC", "VC", "CVV", "CCV", "CVVC", "CCVC"
];

// Suffix families loosely inspired by real-world exonyms
// (again: these are morphological rules, not real country names)
const SUFFIX_FAMILIES: Array<{ weight: number; forms: string[] }> = [
    { weight: 4, forms: ["ia", "aria", "eria", "oria", "avia", "izia", "osia", "elia", "oria", "enia", "ova", "eva", "ovae"] },       // Latinate/Romance
    { weight: 3, forms: ["land", "lund", "mark", "mere", "holm", "fjord", "wick"] },                                            // Germanic/Nordic-ish
    { weight: 3, forms: ["stan", "bad", "desh", "pur", "garh", "istan"] },                                                     // Indo-Iranian/Persian-esque
    { weight: 2, forms: ["ovia", "ograd", "opol", "ovia", "ovya", "ovik"] },                                                   // Slavic-ish
    { weight: 2, forms: ["que", "aine", "ique", "enne", "otte"] },                                                            // Franco-flavored
    { weight: 2, forms: ["sar", "dar", "zar", "bar", "gar", "tor", "dur"] },                                                    // Broad agglutinative-ish
    { weight: 1, forms: ["atoll", "reach", "expanse", "wilds"] }                                                              // Fun alt-geo flavors
];

export class NameGenerator {
    public genName(opts: CountryNameOptions = {}): string {
        const rnd = typeof opts.seed === "number" ? this.mulberry32(opts.seed) : Math.random;

        let root = this.buildRoot(rnd as RNG);
        const suffix = this.pickSuffix(rnd as RNG);

        // Avoid ugly root+suffix collisions like "...iaia"
        if (/[aeiou]$/.test(root) && /^[aeiou]/.test(suffix)) {
            if (this.chance(0.5, rnd as RNG)) root = root.replace(/[aeiou]+$/, "");
        }

        let name = this.titleCase(root + suffix);

        if (opts.allowDiacritics !== false) {
            name = this.maybeDiacritics(name, rnd as RNG);
        }

        // Final polish
        name = name
            .replace(/([ -])([a-z])/g, (_, sp, c) => sp + c.toUpperCase()) // TitleCase after spaces/hyphens
            .replace(/([aeiou])y([aeiou])/gi, "$1i$2"); // soften awkward vowel-y-vowel

        return name;
    }

    private mulberry32(seed: number): RNG {
        // tiny deterministic RNG so "seed" gives repeatable results
        let t = seed >>> 0;
        return () => {
            t += 0x6D2B79F5;
            let r = Math.imul(t ^ (t >>> 15), 1 | t);
            r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
        };
    }

    private pick<T>(arr: T[], rnd: RNG) { return arr[Math.floor(rnd() * arr.length)]; }
    private chance(p: number, rnd: RNG) { return rnd() < p; }

    private makeSyllable(rnd: RNG): string {
        const t = this.pick(TEMPLATES, rnd);
        let out = "";
        for (const ch of t) {
            if (ch === "C") out += this.pick(C, rnd);
            else out += this.pick(V, rnd);
        }
        return this.tidyOrthography(out);
    }

    // Orthographic cleanups to keep results pronounceable-ish
    private tidyOrthography(s: string): string {
        // collapse triple letters
        s = s.replace(/([a-z])\1\1/gi, "$1$1");
        // avoid awkward qq, vv, yy, etc. but allow double consonants sometimes
        s = s.replace(/q(?!u)/gi, "qu");       // q needs u in many orthographies
        s = s.replace(/([aeiou])\1{2,}/gi, "$1$1");
        // soften gh/x combos
        s = s.replace(/gh(?=[ei])/gi, "g");
        s = s.replace(/x(?=[aou])/gi, "ks");
        // avoid starting with clusters that are super harsh
        s = s.replace(/^(zh|rh)/i, m => m[0].toUpperCase() === "Z" ? "z" : "r");
        return s;
    }

    private weightedPick<T extends { weight: number }>(items: T[], rnd: RNG): T {
        const total = items.reduce((a, b) => a + b.weight, 0);
        let r = rnd() * total;
        for (const it of items) {
            if ((r -= it.weight) <= 0) return it;
        }
        return items[items.length - 1];
    }

    private maybeDiacritics(s: string, rnd: RNG): string {
        if (!this.chance(0.15, rnd)) return s;
        const map: [RegExp, string][] = [
            [/a/gi, "á"], [/e/gi, "ê"], [/i/gi, "í"], [/o/gi, "ó"], [/u/gi, "ú"],
            [/c/gi, "ç"], [/s(?!h)/gi, "š"], [/z/gi, "ž"], [/g/gi, "ğ"]
        ];
        const rule = this.pick(map, rnd);
        return s.replace(rule[0], rule[1]);
    }

    private titleCase(s: string): string {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    private buildRoot(rnd: RNG): string {
        const syllables = 1 + Math.floor(rnd() * 1.5); 
        let root = "";
        for (let i = 0; i < syllables; i++) root += this.makeSyllable(rnd);
        // light smoothing between syllables
        root = root
            .replace(/([bcdfghjklmnpqrstvwxyz])\1{1,}/gi, "$1")     // reduce harsh doubles
            .replace(/([aeiou])([aeiou])/gi, (_, a, b) => (a === b ? a : a + (this.chance(0.4, rnd) ? "y" : "") + b)); // break VV
        return root;
    }

    private pickSuffix(rnd: RNG): string {
        const fam = this.weightedPick(SUFFIX_FAMILIES, rnd);
        return this.pick(fam.forms, rnd);
    }
}