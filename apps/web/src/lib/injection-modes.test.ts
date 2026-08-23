import { describe, expect, it } from "bun:test";
import type { InjectionMode } from "@pdf-injection/contracts";
import { isResearchProbeMode, RESEARCH_PROBE_MODES } from "@/lib/injection-modes";

describe("RESEARCH_PROBE_MODES / isResearchProbeMode", () => {
  it("contains exactly the four round-3 probe conditions, in the order the backend introduced them", () => {
    expect(RESEARCH_PROBE_MODES).toEqual([
      "image_only",
      "freetext_annot",
      "acroform_field",
      "info_dict",
    ]);
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
    ];
    for (const mode of allModes) {
      expect(isResearchProbeMode(mode)).toBe(
        (RESEARCH_PROBE_MODES as readonly InjectionMode[]).includes(mode),
      );
    }
  });
});
