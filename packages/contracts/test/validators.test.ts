import { describe, expect, test } from "bun:test";
import { isExpectedSignal, isExpectedSignalArray, parseExpectedSignals } from "../src/validators";

describe("isExpectedSignal", () => {
  test("accepts a valid exact_phrase signal", () => {
    expect(
      isExpectedSignal({ type: "exact_phrase", value: "Method C", caseSensitive: false }),
    ).toBe(true);
  });

  test("accepts a valid regex signal", () => {
    expect(isExpectedSignal({ type: "regex", pattern: "^Method [A-D]$", flags: "i" })).toBe(true);
  });

  test("accepts a valid methodology_label signal", () => {
    expect(
      isExpectedSignal({ type: "methodology_label", value: "Method C", aliases: ["method c"] }),
    ).toBe(true);
  });

  test("accepts a valid ordered_terms signal", () => {
    expect(isExpectedSignal({ type: "ordered_terms", values: ["robustness", "limitations"] })).toBe(
      true,
    );
  });

  test("accepts a valid section_order signal", () => {
    expect(
      isExpectedSignal({ type: "section_order", values: ["Intro", "Method", "Results"] }),
    ).toBe(true);
  });

  test("rejects an unknown type", () => {
    expect(isExpectedSignal({ type: "unknown_type", value: "x" })).toBe(false);
  });

  test("rejects a missing required field", () => {
    expect(isExpectedSignal({ type: "exact_phrase", value: "Method C" })).toBe(false);
  });

  test("rejects non-object input", () => {
    expect(isExpectedSignal("not-a-signal")).toBe(false);
    expect(isExpectedSignal(null)).toBe(false);
    expect(isExpectedSignal(undefined)).toBe(false);
  });
});

describe("isExpectedSignalArray", () => {
  test("accepts an array of valid signals", () => {
    expect(
      isExpectedSignalArray([
        { type: "methodology_label", value: "Method C", aliases: [] },
        { type: "ordered_terms", values: ["a", "b"] },
      ]),
    ).toBe(true);
  });

  test("accepts an empty array (signals are optional at generation time)", () => {
    expect(isExpectedSignalArray([])).toBe(true);
  });

  test("rejects an array containing an invalid signal", () => {
    expect(
      isExpectedSignalArray([
        { type: "exact_phrase", value: "x", caseSensitive: true },
        { type: "bogus" },
      ]),
    ).toBe(false);
  });

  test("rejects non-array input", () => {
    expect(isExpectedSignalArray({})).toBe(false);
  });
});

describe("parseExpectedSignals", () => {
  test("parses a valid JSON string into ExpectedSignal[]", () => {
    const json = JSON.stringify([{ type: "exact_phrase", value: "hello", caseSensitive: true }]);
    const result = parseExpectedSignals(json);
    expect(result).toEqual([{ type: "exact_phrase", value: "hello", caseSensitive: true }]);
  });

  test("throws on malformed JSON", () => {
    expect(() => parseExpectedSignals("{not json")).toThrow();
  });

  test("throws when JSON is valid but not a valid ExpectedSignal[]", () => {
    expect(() => parseExpectedSignals("{}")).toThrow();
    expect(() => parseExpectedSignals('[{"type":"bogus"}]')).toThrow();
  });

  test("accepts an empty list (signals are optional at generation time)", () => {
    expect(parseExpectedSignals("[]")).toEqual([]);
  });
});
