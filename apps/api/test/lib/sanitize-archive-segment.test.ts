import { describe, expect, test } from "bun:test";
import { sanitizeArchiveSegment } from "../../src/storage";

describe("sanitizeArchiveSegment", () => {
  test("replaces path separators and traversal segments with underscores", () => {
    const result = sanitizeArchiveSegment("../../../../etc/passwd");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result.startsWith(".")).toBe(false);
  });

  test("leaves an ordinary alphanumeric label untouched", () => {
    expect(sanitizeArchiveSegment("A")).toBe("A");
    expect(sanitizeArchiveSegment("student-42")).toBe("student-42");
  });

  test("strips leading dots", () => {
    expect(sanitizeArchiveSegment("..hidden")).not.toMatch(/^\./);
  });

  test("path separators become underscores rather than being dropped (never merges two segments together)", () => {
    expect(sanitizeArchiveSegment("///")).toBe("___");
  });

  test("falls back to a non-empty placeholder for an empty input", () => {
    expect(sanitizeArchiveSegment("")).toBe("item");
  });

  test("caps length at 64 characters", () => {
    const long = "A".repeat(200);
    expect(sanitizeArchiveSegment(long).length).toBeLessThanOrEqual(64);
  });
});
