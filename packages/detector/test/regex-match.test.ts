import { describe, expect, test } from "bun:test";
import { MAX_PATTERN_LENGTH, regexMatch } from "../src/regex-match";

describe("regexMatch", () => {
  test("matches a simple pattern and returns positions", () => {
    const result = regexMatch("F1-score", "gi", "We report the F1-score before accuracy.");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([14]);
    expect(result.error).toBeUndefined();
  });

  test("no match on empty text", () => {
    const result = regexMatch("abc", "g", "");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("returns all occurrence positions for a global-style scan", () => {
    const result = regexMatch("\\bcat\\b", "i", "cat sat near the cat");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([0, 17]);
  });

  test("rejects a disallowed flag (e.g. sticky y) without throwing", () => {
    const result = regexMatch("abc", "y", "abc");
    expect(result.matched).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("rejects a disallowed flag (e.g. dotAll misuse combined with unknown char)", () => {
    const result = regexMatch("abc", "x", "abc");
    expect(result.matched).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("accepts each individually whitelisted flag", () => {
    for (const flag of ["g", "i", "m", "s", "u"]) {
      const result = regexMatch("abc", flag, "abc");
      expect(result.error).toBeUndefined();
    }
  });

  test("an invalid regex pattern returns matched:false with an error, never throws", () => {
    expect(() => regexMatch("(unclosed", "i", "some text")).not.toThrow();
    const result = regexMatch("(unclosed", "i", "some text");
    expect(result.matched).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("a pattern longer than 500 characters is rejected without throwing", () => {
    const longPattern = "a".repeat(501);
    const result = regexMatch(longPattern, "i", "aaa");
    expect(result.matched).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("a pattern at exactly 500 characters is allowed", () => {
    const pattern = "a".repeat(500);
    const result = regexMatch(pattern, "i", "b".repeat(600));
    expect(result.error).toBeUndefined();
    expect(result.matched).toBe(false);
  });

  test("MAX_PATTERN_LENGTH is exported and equals 500", () => {
    expect(MAX_PATTERN_LENGTH).toBe(500);
  });

  describe("nested-quantifier ReDoS guard", () => {
    test("rejects a classic nested-quantifier pattern '(a+)+$' without a catastrophic delay", () => {
      const start = performance.now();
      const result = regexMatch("(a+)+$", "", `${"a".repeat(30)}!`);
      const elapsedMs = performance.now() - start;
      expect(result.matched).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(elapsedMs).toBeLessThan(50);
    });

    test("rejects a non-capturing nested-quantifier pattern '(?:a*)*'", () => {
      const result = regexMatch("(?:a*)*", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");
      expect(result.matched).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    test("rejects the optional-group-repeated shape '(a?)*'", () => {
      const result = regexMatch("(a?)*", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");
      expect(result.matched).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    test("rejects a brace-quantifier nested form '(a{2,})+'", () => {
      const result = regexMatch("(a{2,})+", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");
      expect(result.matched).toBe(false);
      expect(typeof result.error).toBe("string");
    });

    test("does NOT reject a benign repeated group with no inner quantifier, e.g. '(ab)+'", () => {
      const result = regexMatch("(ab)+", "", "ababab");
      expect(result.error).toBeUndefined();
      expect(result.matched).toBe(true);
    });

    test("does NOT reject a benign optional group with no outer quantifier, e.g. '(Method C)?'", () => {
      const result = regexMatch("(Method C)?", "i", "Method C was used.");
      expect(result.error).toBeUndefined();
      expect(result.matched).toBe(true);
    });
  });
});
