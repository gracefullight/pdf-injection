import { describe, expect, test } from "bun:test";
import { methodologyMatch } from "../src/methodology-match";

describe("methodologyMatch", () => {
  test("matches the primary value case-insensitively", () => {
    const result = methodologyMatch("Method C", [], "We chose method c as our baseline approach.");
    expect(result.matched).toBe(true);
    expect(result.matchedTerm).toBe("Method C");
  });

  test("matches an alias when the primary value is absent", () => {
    const result = methodologyMatch(
      "Method C",
      ["the third method"],
      "We used the third method for evaluation.",
    );
    expect(result.matched).toBe(true);
    expect(result.matchedTerm).toBe("the third method");
  });

  test("does not match on 'Method Cat' (word-boundary false positive)", () => {
    const result = methodologyMatch(
      "Method C",
      ["method c"],
      "We observed a Method Cat behavior in the model.",
    );
    expect(result.matched).toBe(false);
  });

  test("matches with surrounding punctuation", () => {
    const result = methodologyMatch("Method C", [], "(Method C) was applied, then Method C.");
    expect(result.matched).toBe(true);
    expect(result.positions.length).toBeGreaterThanOrEqual(1);
  });

  test("tolerates multiple spaces/newlines between the words of a multi-word value", () => {
    const result = methodologyMatch("Method C", [], "We used Method\nC   as the baseline.");
    expect(result.matched).toBe(true);
  });

  test("no match on empty text", () => {
    const result = methodologyMatch("Method C", ["method c"], "");
    expect(result.matched).toBe(false);
    expect(result.positions).toEqual([]);
  });

  test("no aliases provided still works from value alone", () => {
    const result = methodologyMatch("Random Forest", [], "Baseline: Random Forest classifier.");
    expect(result.matched).toBe(true);
    expect(result.matchedTerm).toBe("Random Forest");
  });
});
