import { describe, expect, test } from "bun:test";
import { orderedTermsMatch } from "../src/ordered-terms";

describe("orderedTermsMatch", () => {
  test("matches when all terms appear in the given order", () => {
    const result = orderedTermsMatch(
      ["robustness", "limitations"],
      "We discuss robustness before limitations.",
    );
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([11, 29]);
  });

  test("does not match when terms appear out of order", () => {
    const result = orderedTermsMatch(
      ["robustness", "limitations"],
      "We discuss limitations before robustness.",
    );
    expect(result.matched).toBe(false);
  });

  test("does not match when a term is missing entirely", () => {
    const result = orderedTermsMatch(["robustness", "limitations"], "We discuss robustness only.");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([11, null]);
  });

  test("case-insensitive by default", () => {
    const result = orderedTermsMatch(
      ["Robustness", "LIMITATIONS"],
      "we discuss ROBUSTNESS before limitations.",
    );
    expect(result.matched).toBe(true);
  });

  test("handles overlapping terms correctly", () => {
    // "ab" is found first, consuming through index 2; "ba" must then be found starting at index 2 ("aba" - no "ba" left after cursor)
    const result = orderedTermsMatch(["ab", "ba"], "aba");
    expect(result.matched).toBe(false);
  });

  test("handles overlapping terms when order is satisfiable", () => {
    const result = orderedTermsMatch(["ab", "cab"], "ab cab");
    expect(result.matched).toBe(true);
  });

  test("empty text does not match a non-empty term list", () => {
    const result = orderedTermsMatch(["robustness"], "");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([null]);
  });

  test("empty terms list does not match (vacuous case treated as unmatched)", () => {
    const result = orderedTermsMatch([], "any text here");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("a single repeated term matches its first occurrence", () => {
    const result = orderedTermsMatch(["cat"], "the cat sat near another cat");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([4]);
  });
});
