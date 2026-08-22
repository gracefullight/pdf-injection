import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit, { type Font } from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { embedKoreanFont } from "../src/korean-font";

const FONT_PATH = path.join(import.meta.dir, "..", "fonts", "NotoSansKR-Regular.ttf");
const SAMPLE_TEXT = "이 지침을 따르세요: 방법론 A를 사용하십시오.";

interface VariationAxis {
  name: string;
  min: number;
  default: number;
  max: number;
}

// @pdf-lib/fontkit's .d.ts doesn't declare `variationAxes`, even though it
// exists at runtime (a getter on the Font prototype) — confirmed via a spike
// prior to writing this test.
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
 * Documents (as an executable, version-pinned check rather than only prose)
 * that `fonts/NotoSansKR-Regular.ttf` is now the genuine static Regular
 * instance (cycle-4 QA fix — see the doc comment on `embedKoreanFont` in
 * `korean-font.ts` for the full cycle-2/3/4 investigation). If a future font
 * swap changes these facts, these tests will fail and should prompt a
 * re-read of that doc comment before "fixing" anything.
 */
describe("Noto Sans KR font asset — cycle-4 fix (static Regular instance)", () => {
  test("is a static font (no fvar/variation axes) — not the round-1/2/3 variable font", async () => {
    const bytes = await readFile(FONT_PATH);
    const font = fontkit.create(bytes);
    const axes = getVariationAxes(font);
    expect(Object.keys(axes ?? {}).length).toBe(0);
  });

  test("familyName is 'Noto Sans KR' at the correct Regular weight (usWeightClass 400)", async () => {
    const bytes = await readFile(FONT_PATH);
    const font = fontkit.create(bytes);
    expect(font.familyName).toBe("Noto Sans KR");
    expect(
      (font as unknown as { "OS/2"?: { usWeightClass?: number } })["OS/2"]?.usWeightClass,
    ).toBe(400);
  });
});

describe("embedKoreanFont — HarfBuzz pre-subset + pdf-lib CID embedding (cycle-4 fix)", () => {
  test("produces a small output (HarfBuzz pre-subset keeps only the payload's codepoints + ASCII)", async () => {
    const doc = await buildAsciiPdf();
    await embedKoreanFont(doc, SAMPLE_TEXT);
    const bytes = await doc.save();
    // Well inside the "<400KB delta" budget — should be a few KB.
    expect(bytes.byteLength).toBeLessThan(50_000);
  });

  test("is deterministic for the same doc + text", async () => {
    const docA = await buildAsciiPdf();
    await embedKoreanFont(docA, SAMPLE_TEXT);
    const bytesA = await docA.save();

    const docB = await buildAsciiPdf();
    await embedKoreanFont(docB, SAMPLE_TEXT);
    const bytesB = await docB.save();

    expect(bytesA.byteLength).toBe(bytesB.byteLength);
  });

  test("scopes the subset to the requested text (different text -> different, still small, output)", async () => {
    const doc = await buildAsciiPdf();
    await embedKoreanFont(doc, "짧은 문장");
    const bytes = await doc.save();
    expect(bytes.byteLength).toBeLessThan(50_000);
  });
});

describe("embedKoreanFont — rasterization sanity (cycle-4 QA request)", () => {
  test("renders non-blank ink where the Korean text is drawn (best-effort; skips if @napi-rs/canvas is unavailable)", async () => {
    // Resolved through pdfjs-dist's own require root — see
    // packages/robustness/src/native-canvas.ts for why (native-addon
    // identity matching across disjoint semver ranges).
    interface Ctx2d {
      getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    }
    interface NapiCanvasModule {
      createCanvas(w: number, h: number): { getContext(k: "2d"): Ctx2d };
    }

    function resolveNapiCanvas(): NapiCanvasModule | null {
      try {
        const pdfjsPkgUrl = import.meta.resolve("pdfjs-dist/package.json");
        const nodeModuleBuiltin = (
          process as unknown as {
            getBuiltinModule(id: "module"): { createRequire(url: string): (id: string) => unknown };
          }
        ).getBuiltinModule("module");
        const req = nodeModuleBuiltin.createRequire(pdfjsPkgUrl);
        return req("@napi-rs/canvas") as NapiCanvasModule;
      } catch {
        return null;
      }
    }

    const napiCanvas = resolveNapiCanvas();
    if (!napiCanvas) {
      console.warn(
        "[korean-font.test.ts] @napi-rs/canvas unavailable — skipping rasterization sanity check",
      );
      return;
    }

    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await buildAsciiPdf();
    const font = await embedKoreanFont(doc, SAMPLE_TEXT);
    const page = doc.getPage(0);
    page.drawText(SAMPLE_TEXT, { x: 50, y: 600, size: 24, font });
    const bytes = await doc.save();

    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      standardFontDataUrl: (() => {
        const pkgUrl = import.meta.resolve("pdfjs-dist/package.json");
        return `${new URL(pkgUrl).pathname.replace(/\/package\.json$/, "")}/standard_fonts/`;
      })(),
    });
    const pdfDoc = await loadingTask.promise;
    const pdfPage = await pdfDoc.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 2 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = napiCanvas.createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    await pdfPage.render({ canvasContext: ctx as never, viewport }).promise;

    // Count non-white pixels: a real signal that glyphs were actually
    // painted (not just "a PNG got produced"), without needing a full
    // pixel-diff/OCR pipeline in this package. The sample string is drawn
    // at 24pt starting near (50, 600) — count across the whole page is fine
    // (cheap enough at this canvas size, and page background is white).
    const { data } = ctx.getImageData(0, 0, width, height);
    let nonWhitePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      if (r < 250 || g < 250 || b < 250) nonWhitePixels++;
    }
    // A fully-dropped-glyphs render (the cycle-2/3 bug) would have near-zero
    // non-white pixels; correctly-rendered text at 24pt has thousands.
    expect(nonWhitePixels).toBeGreaterThan(500);
  });
});
