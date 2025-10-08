export type RNG = () => number;

/** Simple deterministic PRNG */
export function makeRNG(seed: string): RNG {
    let x = hash32(seed);
    if (x === 0) x = 0x6d2b79f5;
    return function () {
        x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
        return ((x >>> 0) % 1_000_000) / 1_000_000;
    };
}

export function randomChoice<T>(
    choices: T[],
    rng: RNG = makeRNG(`${Date.now()}`)
) {
    return choices[Math.floor(rng() * choices.length)];
}

export function weightedRandomChoice<T>(
    choices: { val: T, prob: number }[],
    rng: RNG = makeRNG(`${Date.now()}`),
) {
    const total = choices.reduce((sum, c) => sum + c.prob, 0);
    if (total !== 1) {
        throw new Error("weightedRandomChoice: total probability must be > 0");
    }

    const r = rng() * total;
    let acc = 0;

    for (const { val, prob } of choices) {
        acc += prob;
        if (r <= acc) return val;
    }

    // Fallback due to floating point rounding
    return choices[choices.length - 1].val;
}


function hash32(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}