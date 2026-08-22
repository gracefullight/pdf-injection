import { describe, expect, it } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { deriveSignalsFromGuided } from "@/features/instruction-editor/derive-signals-from-guided";
import {
  EMPTY_GUIDED_FIELDS,
  type GuidedInstructionFields,
} from "@/features/instruction-editor/guided-to-raw";

function fields(overrides: Partial<GuidedInstructionFields> = {}): GuidedInstructionFields {
  return { ...EMPTY_GUIDED_FIELDS, ...overrides };
}

describe("deriveSignalsFromGuided", () => {
  it("returns nothing for empty guided fields", () => {
    expect(deriveSignalsFromGuided(fields(), [])).toEqual([]);
  });

  it("derives a methodology_label from preferredMethodology", () => {
    const result = deriveSignalsFromGuided(fields({ preferredMethodology: "Method C" }), []);
    expect(result).toEqual([{ type: "methodology_label", value: "Method C", aliases: [] }]);
  });

  it("trims whitespace and ignores an all-whitespace preferredMethodology", () => {
    expect(deriveSignalsFromGuided(fields({ preferredMethodology: "  Method C  " }), [])).toEqual([
      { type: "methodology_label", value: "Method C", aliases: [] },
    ]);
    expect(deriveSignalsFromGuided(fields({ preferredMethodology: "   " }), [])).toEqual([]);
  });

  it("derives ordered_terms from orderedTerms, trimming and dropping blanks", () => {
    const result = deriveSignalsFromGuided(
      fields({ orderedTerms: [" robustness ", "", "limitations"] }),
      [],
    );
    expect(result).toEqual([{ type: "ordered_terms", values: ["robustness", "limitations"] }]);
  });

  it("does not derive ordered_terms when every term is blank", () => {
    expect(deriveSignalsFromGuided(fields({ orderedTerms: ["", "  "] }), [])).toEqual([]);
  });

  it("derives section_order from requiredSection as a single-item values array", () => {
    const result = deriveSignalsFromGuided(fields({ requiredSection: "Limitations" }), []);
    expect(result).toEqual([{ type: "section_order", values: ["Limitations"] }]);
  });

  it("does not derive a signal for secondaryCondition, requiredLexicalSignal, notes, or prohibitedDisclosure", () => {
    const result = deriveSignalsFromGuided(
      fields({
        secondaryCondition: "it is technically inappropriate",
        requiredLexicalSignal: "trade-off",
        notes: "some free text",
        prohibitedDisclosure: true,
      }),
      [],
    );
    expect(result).toEqual([]);
  });

  it("derives all three signal types at once from a fully filled-in guided form", () => {
    const result = deriveSignalsFromGuided(
      fields({
        preferredMethodology: "Method C",
        orderedTerms: ["robustness", "limitations"],
        requiredSection: "Limitations",
      }),
      [],
    );
    expect(result).toEqual([
      { type: "methodology_label", value: "Method C", aliases: [] },
      { type: "ordered_terms", values: ["robustness", "limitations"] },
      { type: "section_order", values: ["Limitations"] },
    ]);
  });

  it("dedups against an existing methodology_label signal with the same value (case-insensitive)", () => {
    const existing: ExpectedSignal[] = [
      { type: "methodology_label", value: "method c", aliases: ["MC"] },
    ];
    const result = deriveSignalsFromGuided(fields({ preferredMethodology: "Method C" }), existing);
    expect(result).toEqual([]);
  });

  it("dedups against an existing ordered_terms signal with the same values in the same order", () => {
    const existing: ExpectedSignal[] = [
      { type: "ordered_terms", values: ["robustness", "limitations"] },
    ];
    const result = deriveSignalsFromGuided(
      fields({ orderedTerms: ["robustness", "limitations"] }),
      existing,
    );
    expect(result).toEqual([]);
  });

  it("does NOT dedup ordered_terms with the same values in a different order (order is significant)", () => {
    const existing: ExpectedSignal[] = [
      { type: "ordered_terms", values: ["limitations", "robustness"] },
    ];
    const result = deriveSignalsFromGuided(
      fields({ orderedTerms: ["robustness", "limitations"] }),
      existing,
    );
    expect(result).toEqual([{ type: "ordered_terms", values: ["robustness", "limitations"] }]);
  });

  it("dedups against an existing section_order signal with the same section", () => {
    const existing: ExpectedSignal[] = [{ type: "section_order", values: ["Limitations"] }];
    const result = deriveSignalsFromGuided(fields({ requiredSection: "Limitations" }), existing);
    expect(result).toEqual([]);
  });

  it("only filters the duplicate, keeping the other newly-derived signals", () => {
    const existing: ExpectedSignal[] = [
      { type: "methodology_label", value: "Method C", aliases: [] },
    ];
    const result = deriveSignalsFromGuided(
      fields({ preferredMethodology: "Method C", requiredSection: "Limitations" }),
      existing,
    );
    expect(result).toEqual([{ type: "section_order", values: ["Limitations"] }]);
  });

  it("does not derive an unrelated exact_phrase/regex existing signal as a false-positive dedup match", () => {
    const existing: ExpectedSignal[] = [
      { type: "exact_phrase", value: "Method C", caseSensitive: false },
    ];
    const result = deriveSignalsFromGuided(fields({ preferredMethodology: "Method C" }), existing);
    // different signal *type* (methodology_label vs exact_phrase) -> not the same signal, still derived
    expect(result).toEqual([{ type: "methodology_label", value: "Method C", aliases: [] }]);
  });
});
