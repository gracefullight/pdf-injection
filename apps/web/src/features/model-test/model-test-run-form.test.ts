import { describe, expect, it } from "bun:test";
import { CONDITION_LABELS } from "@/features/model-test/model-test-run-form";

describe("model test condition labels", () => {
  it("uses product labels instead of internal probe terminology", () => {
    for (const condition of [
      "image_only",
      "freetext_annot",
      "acroform_field",
      "info_dict",
      "actual_text",
    ] as const) {
      expect(CONDITION_LABELS[condition]).not.toMatch(/research probe|diagnostic|round[- ]?3/i);
    }
  });
});
