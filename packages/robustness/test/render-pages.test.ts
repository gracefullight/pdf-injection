import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { capabilities } from "../src/capabilities";
import { DEFAULT_MAX_RENDER_PIXELS, renderPagesToPng } from "../src/render-pages";

const SMALL_FIXTURE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "one-page-text.pdf",
);

const caps = await capabilities();
if (!caps.canvas) {
  console.warn(
    `[packages/robustness] canvas unavailable, skipping render-pages pixel-budget tests: ${caps.reasons.canvas}`,
  );
}

/** A single-page PDF at the maximum PDF-spec page size (14400x14400pt = 200x200in). */
async function buildOversizedPageFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([14400, 14400]);
  return doc.save();
}

describe("renderPagesToPng — pixel-area budget (Cycle 3 QA fix, MEDIUM)", () => {
  test.skipIf(!caps.canvas)(
    "reduces scale to fit an oversized page within the default pixel budget instead of rendering unbounded",
    async () => {
      const bytes = await buildOversizedPageFixture();
      const result = await renderPagesToPng(bytes, { scale: 2 });

      expect(result.available).toBe(true);
      const page = result.pages[0];
      if (!page) throw new Error("unreachable");

      // Requested scale (2) would need a ~829-megapixel canvas for a
      // 14400x14400pt page; the budget forces a much smaller effective scale.
      expect(page.scaleUsed).toBeLessThan(2);
      expect(page.scaleUsed).toBeGreaterThanOrEqual(0.25);
      expect(page.widthPx * page.heightPx).toBeLessThanOrEqual(DEFAULT_MAX_RENDER_PIXELS * 1.05); // small rounding-up tolerance from Math.ceil
      // Geometry (point size) is still exactly preserved even though pixel resolution was reduced.
      expect(page.widthPt).toBeCloseTo(14400, 0);
      expect(page.heightPt).toBeCloseTo(14400, 0);
    },
  );

  test.skipIf(!caps.canvas)(
    "reports available:false with a reason when a page can't fit even at the minimum scale",
    async () => {
      const bytes = await buildOversizedPageFixture();
      const result = await renderPagesToPng(bytes, { scale: 2, maxRenderPixels: 1000 });

      expect(result.available).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain("too large");
      expect(result.pages).toEqual([]);
    },
  );

  test.skipIf(!caps.canvas)(
    "does not reduce scale for a normal-sized page (no regression)",
    async () => {
      const bytes = await readFile(SMALL_FIXTURE_PATH);
      const result = await renderPagesToPng(bytes, { scale: 2 });

      expect(result.available).toBe(true);
      const page = result.pages[0];
      if (!page) throw new Error("unreachable");
      expect(page.scaleUsed).toBe(2);
    },
  );
});
