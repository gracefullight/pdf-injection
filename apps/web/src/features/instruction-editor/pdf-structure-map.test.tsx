import { describe, expect, it } from "bun:test";
import type { InjectionMode } from "@pdf-injection/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { PdfStructureMap } from "@/features/instruction-editor/pdf-structure-map";
import { ANATOMY_PROVENANCE, INJECTION_ANATOMY } from "@/lib/injection-anatomy";

/** All nine `InjectionMode` values — see injection-settings-form.test.ts for the same list. */
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

describe("INJECTION_ANATOMY completeness", () => {
  it("has anatomy data for all nine injection modes (Record<InjectionMode, …> enforces this at compile time too)", () => {
    expect(Object.keys(INJECTION_ANATOMY).sort()).toEqual([...ALL_INJECTION_MODES].sort());
  });

  it("every mode maps to at least one structural site", () => {
    for (const mode of ALL_INJECTION_MODES) {
      expect(INJECTION_ANATOMY[mode].siteIds.length).toBeGreaterThan(0);
    }
  });
});

describe("PdfStructureMap", () => {
  it("renders a structure location for all nine modes", () => {
    for (const mode of ALL_INJECTION_MODES) {
      const html = renderToStaticMarkup(<PdfStructureMap mode={mode} />);
      expect(html).toContain('data-testid="pdf-structure-map-location"');
      expect(html).toContain(INJECTION_ANATOMY[mode].displayName);
    }
  });

  it("marks the selected mode's site(s) active and dims the rest", () => {
    const html = renderToStaticMarkup(<PdfStructureMap mode="acroform_field" />);
    // acroform_field's only site is acroform_v
    expect(html).toContain('data-testid="pdf-structure-map-site-acroform_v" data-active="true"');
    // a site not used by acroform_field must be present but inactive
    expect(html).toContain('data-testid="pdf-structure-map-site-xmp" data-active="false"');
  });

  it("marks all of unicode_tags' two sites active simultaneously", () => {
    const html = renderToStaticMarkup(<PdfStructureMap mode="unicode_tags" />);
    expect(html).toContain('data-testid="pdf-structure-map-site-content" data-active="true"');
    expect(html).toContain('data-testid="pdf-structure-map-site-tounicode" data-active="true"');
  });

  it("shows the provenance label on every mode, never presenting the verdict as universal", () => {
    for (const mode of ALL_INJECTION_MODES) {
      const html = renderToStaticMarkup(<PdfStructureMap mode={mode} />);
      expect(html).toContain('data-testid="pdf-structure-map-provenance"');
      expect(html).toContain(ANATOMY_PROVENANCE);
    }
  });

  it("acroform_field: the channel that reaches the model is framed as scanner-invisible, not just 'flagged'", () => {
    const html = renderToStaticMarkup(<PdfStructureMap mode="acroform_field" />);
    expect(html).toContain("invisible to the scanner");
    expect(html).toContain("reached · 5/5");
  });

  it("does not soften 'reached' language for reaching modes", () => {
    for (const mode of ["white_text", "render_mode_3", "acroform_field"] as const) {
      const html = renderToStaticMarkup(<PdfStructureMap mode={mode} />);
      expect(html).toContain("reached · 5/5");
    }
  });
});
