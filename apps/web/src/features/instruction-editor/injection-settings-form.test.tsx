import { describe, expect, it } from "bun:test";
import type { InjectionMode } from "@pdf-injection/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
  InjectionSettingsForm,
  MODE_DESCRIPTIONS,
} from "@/features/instruction-editor/injection-settings-form";
import { DEFAULT_INJECTION_SETTINGS } from "@/features/instruction-editor/instruction-types";
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

  it("image_only's description says it is visible and has no text object", () => {
    expect(MODE_DESCRIPTIONS.image_only).toContain("Visible image");
    expect(MODE_DESCRIPTIONS.image_only).toContain("no text object");
  });

  it("freetext_annot and acroform_field identify their storage locations", () => {
    expect(MODE_DESCRIPTIONS.freetext_annot).toContain("PDF annotation");
    expect(MODE_DESCRIPTIONS.acroform_field).toContain("PDF form field");
  });

  it("info_dict's description says it uses PDF metadata instead of page text", () => {
    expect(MODE_DESCRIPTIONS.info_dict).toContain("PDF metadata instead of page text");
  });

  it("none of the four round-3 probe descriptions claim the payload reaches a model", () => {
    for (const mode of RESEARCH_PROBE_MODES) {
      expect(MODE_DESCRIPTIONS[mode].toLowerCase()).not.toContain("the model");
    }
  });

  it("uses user-facing language instead of internal research-phase terminology", () => {
    for (const mode of RESEARCH_PROBE_MODES) {
      expect(MODE_DESCRIPTIONS[mode]).not.toMatch(
        /round[- ]?3|diagnostic probe|production channel/i,
      );
    }
  });
});

describe("InjectionSettingsForm — experimental mode guidance", () => {
  it("explains PDF metadata mode without internal research jargon or CLI tool names", () => {
    const html = renderToStaticMarkup(
      <InjectionSettingsForm
        settings={{ ...DEFAULT_INJECTION_SETTINGS, mode: "info_dict" }}
        onChange={noop}
        pageCount={1}
        instruction="Use Method C."
        koPayloadAvailable={true}
        zhPayloadAvailable={true}
        canvasAvailable={true}
      />,
    );

    expect(html).toContain("Experimental");
    expect(html).toContain("PDF metadata");
    expect(html).toContain("original document title stays unchanged");
    expect(html).not.toMatch(/round[- ]?3|diagnostic probe|production channel|pdfinfo/i);
  });
});

describe("isResearchProbeMode", () => {
  it("is true for exactly the probe conditions that did not reach the model", () => {
    // acroform_field is excluded on purpose: it reached the model 5/5, so it is
    // a proven channel rather than an experimental probe (injection-modes.ts).
    expect(RESEARCH_PROBE_MODES).toEqual(["image_only", "freetext_annot", "info_dict"]);
    expect(isResearchProbeMode("acroform_field")).toBe(false);
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

/** noop — these render() calls only inspect static markup, never trigger onChange. */
function noop() {}

describe("InjectionSettingsForm — Chinese payload language", () => {
  // The Chinese `SelectItem` (data-testid="payload-language-option-zh") and its
  // zhPayloadAvailable-gated disabled/"(unavailable on this server)" state live inside Radix
  // Select's Portal-rendered `SelectContent`, which only mounts once the trigger is opened —
  // this codebase has no jsdom/testing-library setup to open it, so that markup never appears
  // in `renderToStaticMarkup` output (same limitation noted in instruction-screen.tsx for its
  // own UI-wiring bug; the E2E suite is the regression test for interactive Select behavior).
  // What IS always in the static markup — the payload-language helper text and the non-ASCII
  // suggestion alert — is covered below.

  it("does not claim Korean payload covers Chinese: the zh description names its own font", () => {
    const html = renderToStaticMarkup(
      <InjectionSettingsForm
        settings={{ ...DEFAULT_INJECTION_SETTINGS, payloadLanguage: "zh" }}
        onChange={noop}
        pageCount={1}
        instruction=""
        koPayloadAvailable={true}
        zhPayloadAvailable={true}
        canvasAvailable={true}
      />,
    );
    expect(html).toContain("Noto Sans SC");
    expect(html).not.toContain("Noto Sans KR");
  });

  it("suggests both Korean and Chinese (not just Korean) for non-ASCII instructions", () => {
    const html = renderToStaticMarkup(
      <InjectionSettingsForm
        settings={DEFAULT_INJECTION_SETTINGS}
        onChange={noop}
        pageCount={1}
        instruction="한국어와 中文 mixed"
        koPayloadAvailable={true}
        zhPayloadAvailable={true}
        canvasAvailable={true}
      />,
    );
    expect(html).toContain('data-testid="payload-language-ko-suggestion"');
    expect(html).toContain("Switch payload language to Korean or Chinese");
  });

  it("notes both are unavailable only when neither Korean nor Chinese payload is available", () => {
    const html = renderToStaticMarkup(
      <InjectionSettingsForm
        settings={DEFAULT_INJECTION_SETTINGS}
        onChange={noop}
        pageCount={1}
        instruction="한국어"
        koPayloadAvailable={false}
        zhPayloadAvailable={false}
        canvasAvailable={true}
      />,
    );
    expect(html).toContain("Both Korean and Chinese payload are currently unavailable");
  });
});
