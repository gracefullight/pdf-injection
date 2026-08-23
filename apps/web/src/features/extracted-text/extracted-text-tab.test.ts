import { describe, expect, it } from "bun:test";
import { NON_EXTRACTABLE_MODE_NOTES } from "@/features/extracted-text/extracted-text-tab";

describe("NON_EXTRACTABLE_MODE_NOTES", () => {
  it("has an explanatory notice for unicode_tags and all four round-3 probe modes", () => {
    expect(Object.keys(NON_EXTRACTABLE_MODE_NOTES).sort()).toEqual(
      ["unicode_tags", "image_only", "freetext_annot", "acroform_field", "info_dict"].sort(),
    );
  });

  it("has no entry for the three modes whose payload PDF.js can find (white_text, render_mode_3, visible_positive_control) or xmp_only", () => {
    expect(NON_EXTRACTABLE_MODE_NOTES.white_text).toBeUndefined();
    expect(NON_EXTRACTABLE_MODE_NOTES.render_mode_3).toBeUndefined();
    expect(NON_EXTRACTABLE_MODE_NOTES.visible_positive_control).toBeUndefined();
    expect(NON_EXTRACTABLE_MODE_NOTES.xmp_only).toBeUndefined();
  });

  it("preserves the pre-existing unicode_tags copy verbatim (tests/e2e/tests/unicode-tags.spec.ts asserts on it)", () => {
    expect(NON_EXTRACTABLE_MODE_NOTES.unicode_tags).toContain(
      "not visible to PDF.js text extraction",
    );
  });

  it("image_only's note says no text-based extractor can show it", () => {
    expect(NON_EXTRACTABLE_MODE_NOTES.image_only).toContain("No text-based extractor");
  });

  it("freetext_annot and acroform_field notes explain the relevant reader behavior", () => {
    expect(NON_EXTRACTABLE_MODE_NOTES.freetext_annot).toContain("annotation content");
    expect(NON_EXTRACTABLE_MODE_NOTES.acroform_field).toContain("form-aware PDF readers");
  });

  it("info_dict's note says it is surfaced only by metadata reads", () => {
    expect(NON_EXTRACTABLE_MODE_NOTES.info_dict).toContain("metadata-aware reader");
  });

  it("none of the four round-3 probe notes claim the payload reaches a model", () => {
    for (const mode of ["image_only", "freetext_annot", "acroform_field", "info_dict"] as const) {
      expect(NON_EXTRACTABLE_MODE_NOTES[mode]?.toLowerCase()).not.toContain("the model");
    }
  });

  it("does not expose internal research-phase terminology", () => {
    for (const mode of ["image_only", "freetext_annot", "acroform_field", "info_dict"] as const) {
      expect(NON_EXTRACTABLE_MODE_NOTES[mode]).not.toMatch(
        /round[- ]?3|research probe|production channel|pdfinfo/i,
      );
    }
  });
});
