import { sha256Hex } from "@pdf-injection/validation";

/**
 * Derives a deterministic 32-bit unsigned seed from an arbitrary list of
 * strings (hashed together via SHA-256, first 4 bytes taken as a uint32).
 */
export function seedFromParts(...parts: string[]): number {
  const hex = sha256Hex(parts.join(":"));
  return Number.parseInt(hex.slice(0, 8), 16) >>> 0;
}

/**
 * mulberry32 — small, fast, deterministic PRNG (public domain algorithm).
 * Returns a generator function producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: builds a seeded PRNG directly from the parts to hash. */
export function createSeededRng(...parts: string[]): () => number {
  return mulberry32(seedFromParts(...parts));
}
