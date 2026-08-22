import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText } from "@pdf-injection/validation";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { capabilities } from "../src/capabilities";
import { dispose, getOcrWorker, ocrImage, ocrRegenerate } from "../src/ocr";
import { renderPagesToPng } from "../src/render-pages";

const FIXTURE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "one-page-text.pdf",
);

const caps = await capabilities();
if (!caps.ocr) {
  console.warn(`[packages/robustness] OCR unavailable, skipping ocr tests: ${caps.reasons.ocr}`);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Fraction of `expected` words present (as a set, case-insensitive) in `actual`. */
function wordRecoveryRatio(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1;
  const actualSet = new Set(actual);
  const recovered = expected.filter((w) => actualSet.has(w)).length;
  return recovered / expected.length;
}

/** Raw pdfjs text extraction of a given page (1-based), used as a "ground truth" / actual-output word list for recovery-ratio comparisons. */
async function pageText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  await pdf.destroy();
  return textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

describe("ocrRegenerate", () => {
  test.skipIf(!caps.ocr)(
    "recovers at least 80% of the source words from a simple rendered page",
    async () => {
      const bytes = await readFile(FIXTURE_PATH);
      const sourceText = await pageText(bytes);

      const result = await ocrRegenerate(bytes, { scale: 2 });
      expect(result.available).toBe(true);
      expect(result.pages).toHaveLength(1);
      const page = result.pages[0];
      if (!page) throw new Error("unreachable");
      expect(page.confidence).toBeGreaterThan(0);

      const ratio = wordRecoveryRatio(words(sourceText), words(page.text));
      expect(ratio).toBeGreaterThanOrEqual(0.8);
      expect(result.fullText.length).toBeGreaterThan(0);
    },
  );

  // Cycle 2: the invisible-text-layer PDF (result.bytes).
  test.skipIf(!caps.ocr)(
    "bytes is an image page + invisible text layer PDF: page count/geometry match the source, and extractText recovers >= 80% of the source words",
    async () => {
      const bytes = await readFile(FIXTURE_PATH);
      const sourceDoc = await PDFDocument.load(bytes);
      const sourcePages = sourceDoc.getPages();

      const result = await ocrRegenerate(bytes, { scale: 2 });
      expect(result.available).toBe(true);
      expect(result.bytes).toBeDefined();
      if (!result.bytes) throw new Error("unreachable");

      const outDoc = await PDFDocument.load(result.bytes);
      const outPages = outDoc.getPages();
      expect(outPages).toHaveLength(sourcePages.length);
      for (let i = 0; i < sourcePages.length; i++) {
        const sourcePage = sourcePages[i];
        const outPage = outPages[i];
        if (!sourcePage || !outPage) throw new Error("unreachable");
        expect(outPage.getWidth()).toBeCloseTo(sourcePage.getWidth(), 1);
        expect(outPage.getHeight()).toBeCloseTo(sourcePage.getHeight(), 1);
      }

      // The text layer is genuinely extractable (not just visually present):
      // @pdf-injection/validation's extractText (pdfjs getTextContent) finds
      // a known phrase from the source on the regenerated page.
      const extraction = await extractText({
        bytes: result.bytes,
        targetInstruction: "Method",
        targetPageIndex: 0,
      });
      expect(extraction.pages[0]?.textLength).toBeGreaterThan(0);
      expect(extraction.anyPageMatch).toBe(true);

      // Word-recovery ratio, same measure as the plain-text OCR test above,
      // computed on the regenerated PDF's extracted text instead of the raw
      // OCR text string.
      const sourceText = await pageText(bytes);
      const regeneratedText = await pageText(result.bytes);
      const ratio = wordRecoveryRatio(words(sourceText), words(regeneratedText));
      expect(ratio).toBeGreaterThanOrEqual(0.8);
    },
  );

  test.skipIf(!caps.canvas || caps.ocr)(
    "reports available:false with a reason when the OCR worker is unavailable",
    async () => {
      const bytes = await readFile(FIXTURE_PATH);
      const result = await ocrRegenerate(bytes, { scale: 2 });
      expect(result.available).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.pages).toEqual([]);
      expect(result.bytes).toBeUndefined();
    },
  );
});

describe("ocrImage", () => {
  test.skipIf(!caps.ocr)("OCRs a single rasterized page image", async () => {
    const bytes = await readFile(FIXTURE_PATH);
    const rendered = await renderPagesToPng(bytes, { scale: 2 });
    expect(rendered.available).toBe(true);
    const page = rendered.pages[0];
    if (!page) throw new Error("unreachable");

    const result = await ocrImage(page.png);
    expect(result.available).toBe(true);
    expect(result.text.toLowerCase()).toContain("method");
  });
});

// Cycle 3 QA fix (LOW). Placed last in this file so it doesn't add worker
// re-init latency ahead of the OCR-accuracy assertions above (dispose() +
// the next getOcrWorker() call re-pay the (cheap, cached-traineddata) init
// cost). Order-independence isn't required for correctness here either way:
// every function under test lazily re-initializes the worker on demand.
describe("dispose", () => {
  test.skipIf(!caps.ocr)(
    "terminates the cached worker so the next getOcrWorker() call creates a fresh one",
    async () => {
      const before = await getOcrWorker("eng");
      expect(before.worker).not.toBeNull();

      await dispose(); // must resolve without throwing (i.e. worker.terminate() succeeded)

      const after = await getOcrWorker("eng");
      expect(after.worker).not.toBeNull();
      // Different object identity proves the cache was actually cleared and a
      // brand-new worker was created, not the same (possibly now-terminated)
      // instance handed back again.
      expect(after.worker).not.toBe(before.worker);

      // Functional sanity: the freshly-created worker still works end-to-end.
      const bytes = await readFile(FIXTURE_PATH);
      const rendered = await renderPagesToPng(bytes, { scale: 2 });
      const page = rendered.pages[0];
      if (!page) throw new Error("unreachable");
      const result = await ocrImage(page.png);
      expect(result.available).toBe(true);
    },
  );
});
