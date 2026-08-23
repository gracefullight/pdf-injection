import { describe, expect, it } from "bun:test";
import type { InjectionMode } from "@pdf-injection/contracts";
import { MODE_DESCRIPTIONS } from "@/features/instruction-editor/injection-settings-form";
import { isResearchProbeMode, RESEARCH_PROBE_MODES } from "@/lib/injection-modes";

/**
 * All nine `InjectionMode` values: the five pre-existing production/positive-control channels
 * plus the four round-3 research/diagnostic probes wired in this task. `Record<InjectionMode, string>`
 * already forces `MODE_DESCRIPTIONS` to be exhaustive at compile time — this test is the runtime
 * companion, asserting the exact set (catches an accidental extra/renamed key that the compiler
 * wouldn't).
 */
const ALL_INJECTION_MODES: InjectionMode[] = [
  "white_text",
  "render_mode_3",
  "visible_positive_control",
  "xmp_only",
  "unicode_tags",
  "image_only",
  "freetext_annot",
  "acroform_field",
  "info_dict",
];

describe("MODE_DESCRIPTIONS", () => {
  it("has a description for all nine injection modes", () => {
    expect(Object.keys(MODE_DESCRIPTIONS).sort()).toEqual([...ALL_INJECTION_MODES].sort());
  });

  it("every description is non-empty", () => {
    for (const mode of ALL_INJECTION_MODES) {
      expect(MODE_DESCRIPTIONS[mode].length).toBeGreaterThan(0);
    }
  });

  it("image_only's description says it is visible by design, not a hiding technique", () => {
    expect(MODE_DESCRIPTIONS.image_only).toContain("visible by design");
    expect(MODE_DESCRIPTIONS.image_only).toContain("No text object exists");
  });

  it("freetext_annot and acroform_field describe the PDF.js-vs-poppler extraction split", () => {
    expect(MODE_DESCRIPTIONS.freetext_annot).toContain(
      "Not seen by this app's PDF.js-based extractor",
    );
    expect(MODE_DESCRIPTIONS.freetext_annot).toContain("poppler pdftotext");
    expect(MODE_DESCRIPTIONS.acroform_field).toContain(
      "Not seen by this app's PDF.js-based extractor",
    );
    expect(MODE_DESCRIPTIONS.acroform_field).toContain("poppler pdftotext");
  });

  it("info_dict's description says the payload never appears in page text and Title is preserved", () => {
    expect(MODE_DESCRIPTIONS.info_dict).toContain("not in any page's text");
    expect(MODE_DESCRIPTIONS.info_dict).toContain("original Title is preserved");
  });

  it("none of the four round-3 probe descriptions claim the payload reaches a model", () => {
    for (const mode of RESEARCH_PROBE_MODES) {
      expect(MODE_DESCRIPTIONS[mode].toLowerCase()).not.toContain("the model");
    }
  });
});

describe("isResearchProbeMode", () => {
  it("is true for exactly the four round-3 probe conditions", () => {
    expect(RESEARCH_PROBE_MODES).toEqual([
      "image_only",
      "freetext_annot",
      "acroform_field",
      "info_dict",
    ]);
    for (const mode of RESEARCH_PROBE_MODES) {
      expect(isResearchProbeMode(mode)).toBe(true);
    }
  });

  it("is false for the five pre-existing modes (not round-3 probes, whatever their own research/production status)", () => {
    const nonProbeModes: InjectionMode[] = [
      "white_text",
      "render_mode_3",
      "visible_positive_control",
      "xmp_only",
      "unicode_tags",
    ];
    for (const mode of nonProbeModes) {
      expect(isResearchProbeMode(mode)).toBe(false);
    }
  });
});
