import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/errors";
import { resolveTargetPage, resolveTargetPages } from "../src/resolve-target-page";

describe("resolveTargetPage", () => {
  test('"first" resolves to 0-based index 0', () => {
    expect(resolveTargetPage("first", 5)).toBe(0);
  });

  test('"last" resolves to 0-based index pageCount - 1', () => {
    expect(resolveTargetPage("last", 5)).toBe(4);
  });

  test("1-based integer resolves to 0-based index", () => {
    expect(resolveTargetPage(1, 5)).toBe(0);
    expect(resolveTargetPage(4, 5)).toBe(3);
    expect(resolveTargetPage(5, 5)).toBe(4);
  });

  test("throws for page 0 (not 1-based)", () => {
    expect(() => resolveTargetPage(0, 5)).toThrow();
  });

  test("throws for negative page numbers", () => {
    expect(() => resolveTargetPage(-1, 5)).toThrow();
  });

  test("throws when page number exceeds pageCount", () => {
    expect(() => resolveTargetPage(6, 5)).toThrow();
  });

  test("throws for a single-page document with page 2", () => {
    expect(() => resolveTargetPage(2, 1)).toThrow();
  });

  test('"last" on a single-page document resolves to 0', () => {
    expect(resolveTargetPage("last", 1)).toBe(0);
  });

  test("out-of-range targetPage throws a typed ValidationError with code VALIDATION_ERROR", () => {
    expect(() => resolveTargetPage(6, 5)).toThrow(ValidationError);
    try {
      resolveTargetPage(6, 5);
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("VALIDATION_ERROR");
    }
  });

  test("zero-page document throws a typed ValidationError", () => {
    expect(() => resolveTargetPage("first", 0)).toThrow(ValidationError);
  });

  test('"all" collapses to the first page for single-page callers', () => {
    expect(resolveTargetPage("all", 5)).toBe(0);
  });
});

describe("resolveTargetPages", () => {
  test('"all" resolves to every 0-based page index, ascending', () => {
    expect(resolveTargetPages("all", 5)).toEqual([0, 1, 2, 3, 4]);
  });

  test('"all" on a single-page document resolves to [0]', () => {
    expect(resolveTargetPages("all", 1)).toEqual([0]);
  });

  test("every non-'all' value resolves to exactly one index", () => {
    expect(resolveTargetPages("first", 5)).toEqual([0]);
    expect(resolveTargetPages("last", 5)).toEqual([4]);
    expect(resolveTargetPages(3, 5)).toEqual([2]);
  });

  test("out-of-range and zero-page inputs throw the same typed ValidationError", () => {
    expect(() => resolveTargetPages(6, 5)).toThrow(ValidationError);
    expect(() => resolveTargetPages("all", 0)).toThrow(ValidationError);
  });
});
