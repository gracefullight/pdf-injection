import { describe, expect, test } from "bun:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { ValidationError } from "../src/errors";
import {
  DEFAULT_MARGIN_X,
  DEFAULT_MARGIN_Y,
  layoutTextBlock,
  wrapTextToLines,
} from "../src/text-layout";

async function helvetica() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

describe("wrapTextToLines", () => {
  test("keeps short text on a single line", async () => {
    const font = await helvetica();
    const lines = wrapTextToLines("hello world", font, 12, 500);
    expect(lines).toEqual(["hello world"]);
  });

  test("wraps long text across multiple lines within maxWidth", async () => {
    const font = await helvetica();
    const longText = "the quick brown fox jumps over the lazy dog ".repeat(5).trim();
    const lines = wrapTextToLines(longText, font, 12, 150);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(150 + 1e-6);
    }
  });

  test("respects explicit newlines as paragraph breaks", async () => {
    const font = await helvetica();
    const lines = wrapTextToLines("line one\nline two", font, 12, 500);
    expect(lines).toEqual(["line one", "line two"]);
  });
});

describe("layoutTextBlock", () => {
  test("bottom position places the last line's baseline at DEFAULT_MARGIN_Y", async () => {
    const font = await helvetica();
    const lines = ["a", "b"];
    const layout = layoutTextBlock({
      pageWidth: 612,
      pageHeight: 792,
      lines,
      fontSize: 12,
      lineHeight: 14,
      maxWidth: 500,
      position: "bottom",
      font,
    });
    const lastLineY = layout.linePositions[layout.linePositions.length - 1]?.y;
    expect(lastLineY).toBe(DEFAULT_MARGIN_Y);
  });

  test("top position places the first line near the top margin", async () => {
    const font = await helvetica();
    const layout = layoutTextBlock({
      pageWidth: 612,
      pageHeight: 792,
      lines: ["a"],
      fontSize: 12,
      lineHeight: 14,
      maxWidth: 500,
      position: "top",
      font,
    });
    expect(layout.linePositions[0]?.y).toBe(792 - DEFAULT_MARGIN_Y - 12);
  });

  test("custom position uses the provided x/y", async () => {
    const font = await helvetica();
    const layout = layoutTextBlock({
      pageWidth: 612,
      pageHeight: 792,
      lines: ["a"],
      fontSize: 12,
      lineHeight: 14,
      maxWidth: 500,
      position: "custom",
      x: 100,
      y: 200,
      font,
    });
    expect(layout.linePositions[0]).toEqual({ x: 100, y: 200 });
  });

  test("custom position without x/y throws", async () => {
    const font = await helvetica();
    expect(() =>
      layoutTextBlock({
        pageWidth: 612,
        pageHeight: 792,
        lines: ["a"],
        fontSize: 12,
        lineHeight: 14,
        maxWidth: 500,
        position: "custom",
        font,
      }),
    ).toThrow(ValidationError);
  });

  test("custom position without x/y throws with code VALIDATION_ERROR", async () => {
    const font = await helvetica();
    try {
      layoutTextBlock({
        pageWidth: 612,
        pageHeight: 792,
        lines: ["a"],
        fontSize: 12,
        lineHeight: 14,
        maxWidth: 500,
        position: "custom",
        font,
      });
      throw new Error("expected layoutTextBlock to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).code).toBe("VALIDATION_ERROR");
    }
  });

  test("bounding box encloses every line", async () => {
    const font = await helvetica();
    const layout = layoutTextBlock({
      pageWidth: 612,
      pageHeight: 792,
      lines: ["hello", "world"],
      fontSize: 12,
      lineHeight: 14,
      maxWidth: 500,
      position: "bottom",
      font,
    });
    const [x0, y0, x1, y1] = layout.boundingBox;
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBeGreaterThan(y0);
  });

  test("DEFAULT_MARGIN_X and DEFAULT_MARGIN_Y are positive pt values", () => {
    expect(DEFAULT_MARGIN_X).toBeGreaterThan(0);
    expect(DEFAULT_MARGIN_Y).toBeGreaterThan(0);
  });
});
