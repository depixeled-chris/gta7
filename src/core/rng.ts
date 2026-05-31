/**
 * Deterministic PRNG (mulberry32). Seeding it with the same value always
 * yields the same stream, which is what makes the procedural city
 * reproducible and therefore testable.
 */
export type Rng = {
  next(): number; // [0, 1)
  range(min: number, max: number): number;
  int(min: number, max: number): number; // inclusive
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
};

/**
 * Mix a world seed with extra tags (chunk coords, a field name) into a stable
 * uint32 seed. Each chunk/field gets its own deterministic stream, decorrelated
 * from its neighbors — the basis for per-chunk world generation that's identical
 * regardless of visit order. splitmix32 avalanche over an FNV-1a hash of the tags.
 */
export function hashSeed(worldSeed: number, ...tags: (string | number)[]): number {
  let h = (0x811c9dc5 ^ (worldSeed | 0)) >>> 0;
  const mix = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const tag of tags) {
    const s = String(tag);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
    mix(0x3b); // ';' separator so ('a','b') ≠ ('ab')
  }
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}
