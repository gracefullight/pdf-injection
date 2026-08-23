import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { embedChineseFont } from "../src/korean-font";

const FONT_PATH = path.join(import.meta.dir, "..", "fonts", "NotoSansSC-Regular.ttf");
// Simplified-only forms (术/设/计/务/债) that the bundled Noto Sans KR font
// notably misses (see korean-font.ts's doc comment on FONT_FILENAMES for why
// "zh" is keyed to its own font rather than reusing "ko"'s).
const SAMPLE_TEXT = "请遵循此说明：使用方法A，并讨论其局限性与设计债务。";

interface VariationAxis {
  name: string;
  min: number;
  default: number;
  max: number;
}

// @pdf-lib/fontkit's .d.ts doesn't declare `variationAxes`, even though it
// exists at runtime (a getter on the Font prototype) — same finding as
// korean-font.test.ts.
function getVariationAxes(font: Font): Record<string, VariationAxis> {
  return (font as unknown as { variationAxes: Record<string, VariationAxis> }).variationAxes;
}

async function buildAsciiPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("placeholder", { x: 50, y: 700, size: 12, font });
  return doc;
}

/**
 * Mirrors korean-font.test.ts's cycle-4 font-asset checks for the bundled
 * Simplified Chinese font: a static Regular instance (wght=400) instanced
 * from the OFL Noto Sans SC variable font — same provenance/rationale as
 * the Korean font, verified end-to-end via the identical HarfBuzz-pre-subset
 * + pdf-lib subset:true pipeline.
 */
describe("Noto Sans SC font asset (static Regular instance)", () => {
  test("is a static font (no fvar/variation axes)", async () => {
    const bytes = await readFile(FONT_PATH);
    const font = fontkit.create(bytes);
    const axes = getVariationAxes(font);
    expect(Object.keys(axes ?? {}).length).toBe(0);
  });

  test("familyName includes 'Noto Sans SC' at the correct Regular weight (usWeightClass 400)", async () => {
    const bytes = await readFile(FONT_PATH);
    const font = fontkit.create(bytes);
    expect(font.familyName).toContain("Noto Sans SC");
    expect(
      (font as unknown as { "OS/2"?: { usWeightClass?: number } })["OS/2"]?.usWeightClass,
    ).toBe(400);
  });
});

describe("embedChineseFont — HarfBuzz pre-subset + pdf-lib CID embedding", () => {
  test("produces a small output (HarfBuzz pre-subset keeps only the payload's codepoints + ASCII)", async () => {
    const doc = await buildAsciiPdf();
    await embedChineseFont(doc, SAMPLE_TEXT);
    const bytes = await doc.save();
    // Well inside the "<400KB delta" budget — should be a few KB.
    expect(bytes.byteLength).toBeLessThan(50_000);
  });

  test("is deterministic for the same doc + text", async () => {
    const docA = await buildAsciiPdf();
    await embedChineseFont(docA, SAMPLE_TEXT);
    const bytesA = await docA.save();

    const docB = await buildAsciiPdf();
    await embedChineseFont(docB, SAMPLE_TEXT);
    const bytesB = await docB.save();

    expect(bytesA.byteLength).toBe(bytesB.byteLength);
  });

  test("scopes the subset to the requested text (different text -> different, still small, output)", async () => {
    const doc = await buildAsciiPdf();
    await embedChineseFont(doc, "简短句子");
    const bytes = await doc.save();
    expect(bytes.byteLength).toBeLessThan(50_000);
  });
});
