// Tiny deterministic string-seeded PRNG (FNV-1a hash -> mulberry32), used by
// text-transforms.ts's human_edit / paraphrase-mock so the same
// (seed, input) pair always produces the same output — required for
// reproducible robustness experiments.
export function hashStringToSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Returns a `() => number` generator producing floats in `[0, 1)`, deterministic for a given 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: a deterministic `[0,1)` generator seeded directly from a string. */
export function seededRandom(seed: string): () => number {
  return mulberry32(hashStringToSeed(seed));
}
