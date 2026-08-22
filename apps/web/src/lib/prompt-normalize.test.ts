import { describe, expect, it } from "bun:test";
import { normalizedPromptHash, normalizePrompt, sha256Hex } from "@/lib/prompt-normalize";

describe("normalizePrompt", () => {
  it("converts CRLF to LF", () => {
    expect(normalizePrompt("line one\r\nline two")).toBe("line one\nline two");
  });

  it("trims trailing whitespace per line", () => {
    expect(normalizePrompt("line one   \nline two\t\t")).toBe("line one\nline two");
  });

  it("collapses 3+ blank lines to a single blank line", () => {
    expect(normalizePrompt("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims the overall string", () => {
    expect(normalizePrompt("  \n hello \n  ")).toBe("hello");
  });

  it("is idempotent", () => {
    const once = normalizePrompt("  a\r\n\r\n\r\nb   \n");
    const twice = normalizePrompt(once);
    expect(twice).toBe(once);
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 vector", async () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("normalizedPromptHash", () => {
  it("hashes the normalized form, not the raw input", async () => {
    const raw = "hello \r\nworld   \n\n\n\n";
    const normalized = normalizePrompt(raw);
    expect(await normalizedPromptHash(raw)).toBe(await sha256Hex(normalized));
  });

  it("produces the same hash for two differently-formatted but equivalent inputs", async () => {
    const a = "hello\r\nworld";
    const b = "hello\nworld   ";
    expect(await normalizedPromptHash(a)).toBe(await normalizedPromptHash(b));
  });
});
