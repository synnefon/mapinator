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
    arr: T[],
    rng: RNG = makeRNG(`${Date.now()}`)
) {
    return arr[Math.floor(rng() * arr.length)];
}


function hash32(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}