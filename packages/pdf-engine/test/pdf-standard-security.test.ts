import { describe, expect, test } from "bun:test";
import {
  buildStandardSecurityHandlerR2,
  encryptObjectBytes,
  md5,
  pdfLiteralString,
  rc4,
} from "../src/pdf-standard-security";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe("md5", () => {
  test("matches known test vector for 'hello'", () => {
    expect(hex(md5(new TextEncoder().encode("hello")))).toBe(
      "5d41402abc4b2a76b9719d911017c592".slice(0, 32),
    );
  });

  test("matches known test vector for empty string", () => {
    expect(hex(md5(new Uint8Array(0)))).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});

describe("rc4", () => {
  test("matches the standard 'Key'/'Plaintext' test vector", () => {
    const key = new TextEncoder().encode("Key");
    const plaintext = new TextEncoder().encode("Plaintext");
    const ciphertext = rc4(key, plaintext);
    expect(hex(ciphertext).toUpperCase()).toBe("BBF316E8D940AF0AD3");
  });

  test("is symmetric: rc4(key, rc4(key, data)) === data", () => {
    const key = new TextEncoder().encode("some-key-bytes");
    const data = new TextEncoder().encode("round trips through RC4 exactly");
    const roundTripped = rc4(key, rc4(key, data));
    expect(new TextDecoder().decode(roundTripped)).toBe("round trips through RC4 exactly");
  });
});

describe("buildStandardSecurityHandlerR2", () => {
  test("produces 32-byte O/U and a 5-byte file key for an empty user/owner password", () => {
    const id = md5(new TextEncoder().encode("fixed-test-id"));
    const handler = buildStandardSecurityHandlerR2({ id });
    expect(handler.O).toHaveLength(32);
    expect(handler.U).toHaveLength(32);
    expect(handler.fileKey).toHaveLength(5);
  });

  test("is deterministic for the same inputs", () => {
    const id = md5(new TextEncoder().encode("fixed-test-id"));
    const a = buildStandardSecurityHandlerR2({ id });
    const b = buildStandardSecurityHandlerR2({ id });
    expect(hex(a.O)).toBe(hex(b.O));
    expect(hex(a.U)).toBe(hex(b.U));
    expect(hex(a.fileKey)).toBe(hex(b.fileKey));
  });

  test("throws when id is not exactly 16 bytes", () => {
    expect(() => buildStandardSecurityHandlerR2({ id: new Uint8Array(15) })).toThrow();
  });
});

describe("encryptObjectBytes", () => {
  test("is symmetric for the same object/generation numbers", () => {
    const fileKey = md5(new TextEncoder().encode("file-key-seed")).subarray(0, 5);
    const plaintext = new TextEncoder().encode("BT /F1 12 Tf (hello) Tj ET");
    const ciphertext = encryptObjectBytes(fileKey, 5, 0, plaintext);
    const roundTripped = encryptObjectBytes(fileKey, 5, 0, ciphertext);
    expect(new TextDecoder().decode(roundTripped)).toBe("BT /F1 12 Tf (hello) Tj ET");
  });

  test("differs across object numbers (per-object key derivation)", () => {
    const fileKey = md5(new TextEncoder().encode("file-key-seed")).subarray(0, 5);
    const plaintext = new TextEncoder().encode("same plaintext");
    const a = encryptObjectBytes(fileKey, 5, 0, plaintext);
    const b = encryptObjectBytes(fileKey, 6, 0, plaintext);
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe("pdfLiteralString", () => {
  test("escapes parentheses and backslash", () => {
    const bytes = new TextEncoder().encode("a(b)c\\d");
    expect(pdfLiteralString(bytes)).toBe("(a\\(b\\)c\\\\d)");
  });

  test("octal-escapes non-printable bytes", () => {
    const bytes = new Uint8Array([0x00, 0xff]);
    expect(pdfLiteralString(bytes)).toBe("(\\000\\377)");
  });
});
