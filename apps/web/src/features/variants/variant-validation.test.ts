import { describe, expect, it } from "bun:test";
import { defaultVariantDraft, type VariantDraft } from "@/features/variants/variant-types";
import { isVariantSetValid } from "@/features/variants/variant-validation";

function validVariant(label: string): VariantDraft {
  return {
    label,
    instruction: `Use methodology ${label} for this assignment.`,
    signals: [{ type: "methodology_label", value: `Methodology ${label}`, aliases: [] }],
    acknowledgedWarnings: [],
  };
}

describe("isVariantSetValid", () => {
  it("rejects fewer than 2 variants", () => {
    expect(isVariantSetValid([validVariant("A")], "en")).toBe(false);
  });

  it("rejects more than 8 variants", () => {
    const variants = Array.from({ length: 9 }, (_, i) => validVariant(String.fromCharCode(65 + i)));
    expect(isVariantSetValid(variants, "en")).toBe(false);
  });

  it("accepts 2 well-formed variants", () => {
    expect(isVariantSetValid([validVariant("A"), validVariant("B")], "en")).toBe(true);
  });

  it("rejects duplicate labels", () => {
    expect(isVariantSetValid([validVariant("A"), { ...validVariant("B"), label: "A" }], "en")).toBe(
      false,
    );
  });

  it("rejects a blank instruction", () => {
    expect(isVariantSetValid([{ ...defaultVariantDraft("A") }, validVariant("B")], "en")).toBe(
      false,
    );
  });

  it("accepts a variant with no expected signals (signals are optional)", () => {
    const noSignals: VariantDraft = { ...validVariant("A"), signals: [] };
    expect(isVariantSetValid([noSignals, validVariant("B")], "en")).toBe(true);
  });

  // Cycle 3: payloadLanguage must reach lintPrompt's non-ASCII check, or a
  // Korean variant instruction is always flagged encoding_unsupported even
  // with payloadLanguage "ko" selected.
  it('rejects a non-ASCII instruction under payloadLanguage "en" but accepts it under "ko"', () => {
    const korean: VariantDraft = {
      label: "A",
      instruction: "이 과제에는 방법론 C를 사용하세요.",
      signals: [{ type: "methodology_label", value: "방법론 C", aliases: [] }],
      acknowledgedWarnings: [],
    };
    expect(isVariantSetValid([korean, validVariant("B")], "en")).toBe(false);
    expect(isVariantSetValid([korean, validVariant("B")], "ko")).toBe(true);
  });
});
