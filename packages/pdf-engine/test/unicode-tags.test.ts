import { describe, expect, test } from "bun:test";
import {
  decodeUnicodeTags,
  encodeUnicodeTags,
  stripUnicodeTags,
  UNICODE_TAG_BASE,
  UNICODE_TAG_BEGIN,
  UNICODE_TAG_CANCEL,
} from "../src/unicode-tags";

describe("UNICODE_TAG_* constants", () => {
  test("UNICODE_TAG_BASE is 0xE0000, BEGIN is 0xE0001, CANCEL is 0xE007F", () => {
    expect(UNICODE_TAG_BASE).toBe(0xe0000);
    expect(UNICODE_TAG_BEGIN).toBe(0xe0001);
    expect(UNICODE_TAG_CANCEL).toBe(0xe007f);
  });
});

describe("encodeUnicodeTags", () => {
  test("encodes 'AB' as BEGIN, tag('A'), tag('B'), CANCEL codepoints", () => {
    const result = encodeUnicodeTags("AB");
    const codepoints = Array.from(result).map((c) => c.codePointAt(0));
    expect(codepoints).toEqual([
      UNICODE_TAG_BEGIN,
      UNICODE_TAG_BASE + 0x41,
      UNICODE_TAG_BASE + 0x42,
      UNICODE_TAG_CANCEL,
    ]);
  });

  test("throws on non-ASCII input", () => {
    expect(() => encodeUnicodeTags("café")).toThrow();
  });

  test("throws on empty-range non-printable control characters", () => {
    expect(() => encodeUnicodeTags("hello\x01world")).toThrow();
  });
});

describe("decodeUnicodeTags", () => {
  test("round-trips a plain ASCII instruction via encode/decode", () => {
    const encoded = encodeUnicodeTags("hello world");
    expect(decodeUnicodeTags(encoded)).toEqual(["hello world"]);
  });

  test("tolerant decode: recovers payload when BEGIN/CANCEL frame markers are stripped", () => {
    const encoded = encodeUnicodeTags("hello world");
    const stripped = Array.from(encoded)
      .filter((c) => {
        const cp = c.codePointAt(0) as number;
        return cp !== UNICODE_TAG_BEGIN && cp !== UNICODE_TAG_CANCEL;
      })
      .join("");
    expect(decodeUnicodeTags(stripped)).toEqual(["hello world"]);
  });

  test("returns [] for ordinary text with no tag characters", () => {
    expect(decodeUnicodeTags("just some plain text, nothing hidden here")).toEqual([]);
  });

  test("returns every framed run found when multiple runs are present", () => {
    const combined = `before ${encodeUnicodeTags("first")} middle ${encodeUnicodeTags("second")} after`;
    expect(decodeUnicodeTags(combined)).toEqual(["first", "second"]);
  });
});

describe("stripUnicodeTags", () => {
  test("removes tag-block characters from a mixed string, leaving plain text intact", () => {
    const mixed = `before ${encodeUnicodeTags("X")} after`;
    expect(stripUnicodeTags(mixed)).toBe("before  after");
  });

  test("is a no-op on text with no tag characters", () => {
    expect(stripUnicodeTags("nothing hidden here")).toBe("nothing hidden here");
  });
});
