import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/hash";

describe("sha256Hex", () => {
  test("computes the SHA-256 hex digest of a Uint8Array", () => {
    const bytes = new TextEncoder().encode("hello world");
    expect(sha256Hex(bytes)).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  test("computes the SHA-256 hex digest of a string", () => {
    expect(sha256Hex("hello world")).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  test("empty input produces the well-known empty-string SHA-256", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  test("is deterministic for the same input", () => {
    expect(sha256Hex("pdf-injection")).toBe(sha256Hex("pdf-injection"));
  });
});
