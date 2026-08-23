import { describe, expect, test } from "bun:test";
import {
  DEFAULT_KEY_LENGTH,
  generateStudentKey,
  generateUniqueStudentKeys,
  STUDENT_KEY_CHARSET,
  substituteKey,
} from "@pdf-injection/contracts";

describe("generateStudentKey", () => {
  test("produces a key of the requested length from the unambiguous charset", () => {
    const key = generateStudentKey(DEFAULT_KEY_LENGTH);
    expect(key.length).toBe(DEFAULT_KEY_LENGTH);
    for (const ch of key) {
      expect(STUDENT_KEY_CHARSET.includes(ch)).toBe(true);
    }
  });

  test("charset matches the API contract exactly (excludes 0/O/1/I)", () => {
    expect(STUDENT_KEY_CHARSET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    for (const ambiguous of ["0", "O", "1", "I"]) {
      expect(STUDENT_KEY_CHARSET.includes(ambiguous)).toBe(false);
    }
  });
});

describe("generateUniqueStudentKeys", () => {
  test("returns the requested count, all unique, all the requested length", () => {
    const keys = generateUniqueStudentKeys(500, 6);
    expect(keys.length).toBe(500);
    expect(new Set(keys).size).toBe(500);
    for (const key of keys) expect(key.length).toBe(6);
  });
});

describe("substituteKey", () => {
  test("replaces every {{KEY}} occurrence", () => {
    expect(substituteKey("Hello {{KEY}}, your code is {{KEY}}.", "ABC123")).toBe(
      "Hello ABC123, your code is ABC123.",
    );
  });

  test("no-op when template has no placeholder", () => {
    expect(substituteKey("no placeholder here", "ABC123")).toBe("no placeholder here");
  });
});
