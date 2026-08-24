import { describe, expect, it } from "bun:test";
import type { InjectionMode } from "@pdf-injection/contracts";
import { isResearchProbeMode, RESEARCH_PROBE_MODES } from "@/lib/injection-modes";

describe("RESEARCH_PROBE_MODES / isResearchProbeMode", () => {
  it("contains the probe conditions that did not reach the model, excluding acroform_field", () => {
    // acroform_field came from the same probe round but reached the model 5/5
    // (injection-anatomy.ts), so badging it "Experimental" understated the
    // result — it is deliberately not in this list.
    expect(RESEARCH_PROBE_MODES).toEqual([
      "image_only",
      "freetext_annot",
      "info_dict",
      "actual_text",
    ]);
    expect(isResearchProbeMode("acroform_field")).toBe(false);
  });

  it("isResearchProbeMode agrees with membership in RESEARCH_PROBE_MODES for every InjectionMode", () => {
    const allModes: InjectionMode[] = [
      "white_text",
      "render_mode_3",
      "visible_positive_control",
      "xmp_only",
      "unicode_tags",
      "image_only",
      "freetext_annot",
      "acroform_field",
      "info_dict",
      "actual_text",
    ];
    for (const mode of allModes) {
      expect(isResearchProbeMode(mode)).toBe(
        (RESEARCH_PROBE_MODES as readonly InjectionMode[]).includes(mode),
      );
    }
  });
});
