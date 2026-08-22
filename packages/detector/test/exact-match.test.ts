import { describe, expect, test } from "bun:test";
import { exactMatch } from "../src/exact-match";

describe("exactMatch", () => {
  test("finds a case-sensitive exact match and its position", () => {
    const result = exactMatch("Method C", "The paper uses Method C as baseline.");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([15]);
  });

  test("case-sensitive mismatch does not match by default", () => {
    const result = exactMatch("Method C", "the paper uses method c as baseline.");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("caseSensitive:false matches regardless of case", () => {
    const result = exactMatch("Method C", "the paper uses method c as baseline.", {
      caseSensitive: false,
    });
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([15]);
  });

  test("returns all occurrence positions (substring match, so 'catwalk' also counts)", () => {
    const result = exactMatch("cat", "cat sat on the catwalk near cat");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([0, 15, 28]);
  });

  test("empty text never matches", () => {
    const result = exactMatch("Method C", "");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("empty value never matches", () => {
    const result = exactMatch("", "some text");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("whitespace-normalized variant matches across a newline / extra spaces", () => {
    const result = exactMatch("Method   C", "We used Method\nC as our baseline.", {
      normalizeWhitespace: true,
    });
    expect(result.matched).toBe(true);
  });

  test("whitespace-normalized variant maps positions back to the original text offset", () => {
    const result = exactMatch("Method C", "prefix Method\nC suffix", { normalizeWhitespace: true });
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([7]);
  });

  test("whitespace-normalized variant collapses unicode whitespace and NBSP", () => {
    const text = "We used Method  C in analysis."; // NBSP + em space
    const result = exactMatch("Method C", text, { normalizeWhitespace: true });
    expect(result.matched).toBe(true);
  });

  test("without normalizeWhitespace, extra internal whitespace does NOT match", () => {
    const result = exactMatch("Method C", "We used Method\nC as our baseline.");
    expect(result.matched).toBe(false);
  });
});
