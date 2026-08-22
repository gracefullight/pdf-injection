import { describe, expect, test } from "bun:test";
import { normalizePrompt } from "../src/normalize-prompt";

describe("normalizePrompt", () => {
  test("converts CRLF to LF", () => {
    expect(normalizePrompt("line1\r\nline2\r\n")).toBe("line1\nline2");
  });

  test("trims leading/trailing whitespace overall", () => {
    expect(normalizePrompt("  hello  ")).toBe("hello");
  });

  test("strips trailing whitespace per line", () => {
    expect(normalizePrompt("line1   \nline2\t\nline3")).toBe("line1\nline2\nline3");
  });

  test("collapses 3+ blank lines down to a single blank line", () => {
    const input = "a\n\n\n\n\nb";
    expect(normalizePrompt(input)).toBe("a\n\nb");
  });

  test("is idempotent", () => {
    const once = normalizePrompt("  hello \r\n\r\n\r\n\r\nworld  \t\n");
    const twice = normalizePrompt(once);
    expect(twice).toBe(once);
  });

  test("preserves single blank lines between paragraphs", () => {
    expect(normalizePrompt("a\n\nb")).toBe("a\n\nb");
  });

  test("empty input normalizes to empty string", () => {
    expect(normalizePrompt("")).toBe("");
    expect(normalizePrompt("   \n\n  ")).toBe("");
  });
});
