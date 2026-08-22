import { describe, expect, test } from "bun:test";
import { createSeededRng, mulberry32, seedFromParts } from "../src/prng";

describe("prng", () => {
  test("seedFromParts is deterministic for the same inputs", () => {
    expect(seedFromParts("a", "b")).toBe(seedFromParts("a", "b"));
  });

  test("seedFromParts differs for different inputs (no trivial collision for these cases)", () => {
    expect(seedFromParts("a", "b")).not.toBe(seedFromParts("a", "c"));
    expect(seedFromParts("a", "b")).not.toBe(seedFromParts("b", "a"));
  });

  test("mulberry32 produces a deterministic sequence for a fixed seed", () => {
    const seq1 = Array.from({ length: 5 }, mulberry32(42));
    const seq2 = Array.from({ length: 5 }, mulberry32(42));
    expect(seq1).toEqual(seq2);
  });

  test("mulberry32 values are within [0, 1)", () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("createSeededRng(...parts) is deterministic end-to-end", () => {
    const rng1 = createSeededRng("pdf-sha", "prompt-sha");
    const rng2 = createSeededRng("pdf-sha", "prompt-sha");
    const seq1 = [rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2()];
    expect(seq1).toEqual(seq2);
  });

  test("createSeededRng(...parts) differs for different parts", () => {
    const rngA = createSeededRng("pdf-sha-A", "prompt-sha");
    const rngB = createSeededRng("pdf-sha-B", "prompt-sha");
    expect(rngA()).not.toBe(rngB());
  });
});
