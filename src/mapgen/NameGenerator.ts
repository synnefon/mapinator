// name-generator.ts

export type Family =
  | "romance"
  | "germanic"
  | "slavic"
  | "turkic_persian"
  | "semitic"
  | "bantu_like"
  | "generic";

export interface CountryGenOptions {
  seed?: string | number;
  family?: Family;
  syllables?: [min: number, max: number];
  allowDiacritics?: boolean;
  forceSuffix?: string;
  useArticle?: boolean;
}

type RNG = () => number;

export class NameGenerator {
  private rng: RNG;

  constructor(seed: string | number = Date.now()) {
    this.rng = NameGenerator.makeRNG(seed);
  }

  /** Generate a single country name */
  generate(opts: CountryGenOptions = {}): string {
    const rng = this.rng;
    const family = opts.family ?? this.pickFamily(rng);
    const [minSyl, maxSyl] = opts.syllables ?? [2, 4];
    const coreSylCount = NameGenerator.randInt(rng, minSyl, maxSyl);
    const phon = this.phonologyForFamily(family, opts.allowDiacritics ?? false);
    const suffix = (opts.forceSuffix ?? this.pickSuffix(family)).toLowerCase();

    let stem = this.buildStem(coreSylCount, phon);
    stem = this.tidyStemVsSuffix(stem, suffix);

    let name = this.titleCase(stem + suffix);
    return name;
  }

  /** Generate a batch of names */
  generateMany(n: number, opts: CountryGenOptions = {}): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(this.generate(opts));
    return out;
  }

  // ---------------- helpers ----------------

  private pickFamily(rng: RNG): Family {
    const families: Family[] = [
      "romance", "germanic", "slavic",
      "turkic_persian", "semitic", "bantu_like", "generic"
    ];
    return families[Math.floor(rng() * families.length)];
  }

  private pickSuffix(f: Family): string {
    const suffixes: Record<Family, string[]> = {
      romance: ["ia", "aria", "esia"],
      germanic: ["land", "heim", "berg"],
      slavic: ["ia", "ovia", "grad"],
      turkic_persian: ["stan", "istan", "abad"],
      semitic: ["ia", "aya", "iyya"],
      bantu_like: ["ia", "ana", "uma"],
      generic: ["ia", "land", "ora"]
    };
    const arr = suffixes[f]!;
    return arr[Math.floor(this.rng() * arr.length)];
  }

  private phonologyForFamily(f: Family, diacritics: boolean) {
    // Simplified phonology sets
    const vowels = diacritics ? ["a","e","i","o","u","á","é","í","ó","ú"] : ["a","e","i","o","u"];
    const onsets = ["b","c","d","f","g","k","l","m","n","p","r","s","t","v","z","br","cr","dr","pr","tr"];
    const codas = ["n","r","s","l","m","k",""];

    return { onsets, vowels, codas };
  }

  private buildStem(syllables: number, phon: {onsets:string[], vowels:string[], codas:string[]}): string {
    let out = "";
    for (let i = 0; i < syllables; i++) {
      out += this.pick(phon.onsets) + this.pick(phon.vowels);
      if (this.rng() < 0.5) out += this.pick(phon.codas);
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

  private static randInt(rng: RNG, min: number, max: number): number {
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  /** Simple deterministic PRNG */
  private static makeRNG(seedish: string | number): RNG {
    let x = typeof seedish === "number" ? seedish | 0 : NameGenerator.hash32(String(seedish));
    if (x === 0) x = 0x6d2b79f5;
    return function () {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return ((x >>> 0) % 1_000_000) / 1_000_000;
    };
  }

  private static hash32(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
