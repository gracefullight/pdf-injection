import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extractText } from "@pdf-injection/validation";
import { PDFDocument } from "pdf-lib";
import { capabilities } from "../src/capabilities";
import { printToPdf } from "../src/print-to-pdf";

const FIXTURE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "five-page-text.pdf",
);

const caps = await capabilities();
if (!caps.canvas) {
  console.warn(
    `[packages/robustness] canvas unavailable, skipping printToPdf tests: ${caps.reasons.canvas}`,
  );
}

describe("printToPdf", () => {
  test.skipIf(!caps.canvas)(
    "renders every page to an image-only PDF, preserving page geometry, with no extractable text",
    async () => {
      const bytes = await readFile(FIXTURE_PATH);
      const sourceDoc = await PDFDocument.load(bytes);
      const sourcePages = sourceDoc.getPages();
      expect(sourcePages).toHaveLength(5);

      const result = await printToPdf(bytes, { scale: 2 });
      expect(result.available).toBe(true);
      expect(result.reason).toBeUndefined();
      expect(result.pageCount).toBe(5);
      expect(result.bytes).toBeDefined();
      if (!result.bytes) throw new Error("unreachable");

      const outDoc = await PDFDocument.load(result.bytes);
      const outPages = outDoc.getPages();
      expect(outPages).toHaveLength(5);

      for (let i = 0; i < 5; i++) {
        const sourcePage = sourcePages[i];
        const outPage = outPages[i];
        if (!sourcePage || !outPage) throw new Error("unreachable");
        expect(outPage.getWidth()).toBeCloseTo(sourcePage.getWidth(), 1);
        expect(outPage.getHeight()).toBeCloseTo(sourcePage.getHeight(), 1);
      }

      const extraction = await extractText({
        bytes: result.bytes,
        targetInstruction: "",
        targetPageIndex: 0,
      });
      expect(extraction.pages).toHaveLength(5);
      for (const page of extraction.pages) {
        expect(page.textLength).toBe(0);
      }
    },
  );

  test.skipIf(caps.canvas)(
    "reports available:false with a reason when canvas is unavailable",
    async () => {
      const bytes = await readFile(FIXTURE_PATH);
      const result = await printToPdf(bytes, { scale: 2 });
      expect(result.available).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.bytes).toBeUndefined();
    },
  );
});
