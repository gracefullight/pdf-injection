import { describe, expect, test } from "bun:test";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { extractPagesText, extractText } from "../src/text-extract";

async function buildPdfWithText(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 10, y: 250, size: 12, font, color: rgb(0, 0, 0), maxWidth: 280 });
  }
  return doc.save();
}

describe("extractText", () => {
  test("finds an exact match on the target page", async () => {
    const bytes = await buildPdfWithText([
      "Nothing here",
      "Use Method C as the primary methodology.",
    ]);
    const result = await extractText({
      bytes,
      targetInstruction: "Use Method C as the primary methodology.",
      targetPageIndex: 1,
    });
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]?.exactMatch).toBe(true);
    expect(result.targetPageMatch).toBe(true);
    expect(result.anyPageMatch).toBe(true);
    expect(result.pdfJsVersion.length).toBeGreaterThan(0);
  });

  test("reports no match when the instruction is absent", async () => {
    const bytes = await buildPdfWithText(["This page has unrelated content."]);
    const result = await extractText({
      bytes,
      targetInstruction: "Use Method C.",
      targetPageIndex: 0,
    });
    expect(result.pages[0]?.exactMatch).toBe(false);
    expect(result.targetPageMatch).toBe(false);
    expect(result.anyPageMatch).toBe(false);
    expect(result.pages[0]?.matchOffset).toBeNull();
  });

  test("normalizedMatch tolerates whitespace differences", async () => {
    const bytes = await buildPdfWithText(["Use   Method    C   now"]);
    const result = await extractText({
      bytes,
      targetInstruction: "Use Method C now",
      targetPageIndex: 0,
    });
    expect(result.pages[0]?.normalizedMatch).toBe(true);
  });

  test("caseInsensitiveMatch tolerates case differences", async () => {
    const bytes = await buildPdfWithText(["USE METHOD C NOW"]);
    const result = await extractText({
      bytes,
      targetInstruction: "use method c now",
      targetPageIndex: 0,
    });
    expect(result.pages[0]?.caseInsensitiveMatch).toBe(true);
  });

  test("records textLength and a non-null matchOffset when found", async () => {
    const bytes = await buildPdfWithText(["prefix content Use Method C suffix"]);
    const result = await extractText({
      bytes,
      targetInstruction: "Use Method C",
      targetPageIndex: 0,
    });
    expect(result.pages[0]?.textLength).toBeGreaterThan(0);
    expect(result.pages[0]?.matchOffset).not.toBeNull();
  });

  test("anyPageMatch is true even when the target page itself has no match", async () => {
    const bytes = await buildPdfWithText(["Use Method C here", "unrelated page"]);
    const result = await extractText({
      bytes,
      targetInstruction: "Use Method C here",
      targetPageIndex: 1,
    });
    expect(result.targetPageMatch).toBe(false);
    expect(result.anyPageMatch).toBe(true);
  });
});

describe("extractPagesText (additive, round-2 addendum §6)", () => {
  test("returns raw page text in page order, without match-checking", async () => {
    const bytes = await buildPdfWithText(["First page content.", "Second page content."]);
    const pages = await extractPagesText(bytes);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("First page content.");
    expect(pages[1]).toContain("Second page content.");
  });

  test("returns a single string for a one-page document", async () => {
    const onePage = await buildPdfWithText(["Only page."]);
    const pages = await extractPagesText(onePage);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Only page.");
  });

  test("does not emit the missing standard font data warning", async () => {
    const messages: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => messages.push(args);

    try {
      const bytes = await buildPdfWithText(["Standard font warning regression."]);
      await extractPagesText(bytes);
    } finally {
      console.log = originalLog;
    }

    expect(messages.flat().join(" ")).not.toContain("standardFontDataUrl");
  });
});
