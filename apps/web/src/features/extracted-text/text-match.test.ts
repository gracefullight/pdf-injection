import { describe, expect, it } from "bun:test";
import { computeTextMatch } from "@/features/extracted-text/text-match";

describe("computeTextMatch", () => {
  it("finds an exact match and reports its offset", () => {
    const result = computeTextMatch("prefix text HIDDEN INSTRUCTION suffix", "HIDDEN INSTRUCTION");
    expect(result.exactMatch).toBe(true);
    expect(result.normalizedMatch).toBe(true);
    expect(result.caseInsensitiveMatch).toBe(true);
    expect(result.matchOffset).toBe(12);
  });

  it("finds a whitespace-normalized match when spacing differs", () => {
    const result = computeTextMatch("prefix   HIDDEN   INSTRUCTION   suffix", "HIDDEN INSTRUCTION");
    expect(result.exactMatch).toBe(false);
    expect(result.normalizedMatch).toBe(true);
    expect(result.caseInsensitiveMatch).toBe(true);
  });

  it("finds a case-insensitive match only when case differs", () => {
    const result = computeTextMatch("prefix hidden instruction suffix", "HIDDEN INSTRUCTION");
    expect(result.exactMatch).toBe(false);
    expect(result.normalizedMatch).toBe(false);
    expect(result.caseInsensitiveMatch).toBe(true);
  });

  it("reports no match when the instruction is absent", () => {
    const result = computeTextMatch("completely unrelated page text", "HIDDEN INSTRUCTION");
    expect(result.exactMatch).toBe(false);
    expect(result.normalizedMatch).toBe(false);
    expect(result.caseInsensitiveMatch).toBe(false);
    expect(result.matchOffset).toBeNull();
  });

  it("returns no match for an empty needle instead of a spurious offset-0 match", () => {
    const result = computeTextMatch("any page text", "");
    expect(result.exactMatch).toBe(false);
    expect(result.matchOffset).toBeNull();
  });
});
