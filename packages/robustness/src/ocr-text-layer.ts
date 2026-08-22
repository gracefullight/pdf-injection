// Builds the "OCR-regenerated PDF" for ocrRegenerate(): one page per source
// page, the rendered page PNG as a full-page image (as in print-to-pdf.ts)
// plus an invisible (render mode 3) text layer with each OCR'd word placed
// at its bounding box, mapped from rasterized-pixel space back to PDF point
// space. Mirrors the low-level operator pattern already used by
// packages/pdf-engine/src/inject-render-mode-3.ts (`beginText` /
// `setFontAndSize` / `setTextRenderingMode(Invisible)` / `setTextMatrix` /
// `showText`), reimplemented here rather than imported to keep
// packages/robustness independent of packages/pdf-engine.
import {
  beginText,
  endText,
  PDFDocument,
  StandardFonts,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";
import type { RenderedPage } from "./render-pages";

export interface OcrWordBox {
  text: string;
  /** Tesseract bbox in rasterized-pixel space: x0/y0 = top-left, x1/y1 = bottom-right, y increasing downward. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrPageWords {
  rendered: RenderedPage;
  words: OcrWordBox[];
}

/** Minimum invisible-text font size (points) — guards against a degenerate (near-zero-height) OCR bbox. */
const MIN_FONT_SIZE_PT = 1;

/**
 * Maps a tesseract word bbox (pixel space, y-down, origin top-left) to a PDF
 * draw position (point space, y-up, origin bottom-left) + font size. The
 * font size is the bbox height in points; the draw position is the bbox's
 * bottom-left corner, used directly as the text baseline — close enough for
 * an invisible layer whose only purpose is text extractability, not visual
 * alignment with the image underneath.
 */
export function mapWordBoxToPdfSpace(
  bbox: OcrWordBox["bbox"],
  page: Pick<RenderedPage, "widthPt" | "heightPt" | "widthPx" | "heightPx">,
): { x: number; y: number; size: number } {
  const pxToPtX = page.widthPx > 0 ? page.widthPt / page.widthPx : 1;
  const pxToPtY = page.heightPx > 0 ? page.heightPt / page.heightPx : 1;
  const x = bbox.x0 * pxToPtX;
  const yTop = page.heightPt - bbox.y0 * pxToPtY;
  const yBottom = page.heightPt - bbox.y1 * pxToPtY;
  const size = Math.max(yTop - yBottom, MIN_FONT_SIZE_PT);
  return { x, y: yBottom, size };
}

/**
 * Builds the OCR-regenerated PDF: rendered page image + invisible
 * (render-mode-3) text layer with each word placed at its mapped position.
 * Words whose text can't be encoded with the embedded standard font
 * (Helvetica/WinAnsi — tesseract "eng" output is effectively always plain
 * ASCII/Latin-1, so this is rare) are silently skipped rather than failing
 * the whole page.
 */
export async function buildOcrTextLayerPdf(pages: OcrPageWords[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const { rendered, words } of pages) {
    const pngImage = await doc.embedPng(rendered.png);
    const outPage = doc.addPage([rendered.widthPt, rendered.heightPt]);
    outPage.drawImage(pngImage, { x: 0, y: 0, width: rendered.widthPt, height: rendered.heightPt });

    if (words.length === 0) continue;

    // Registers the font in this page's /Resources /Font dict and returns
    // its resource key (e.g. /F1) for the raw `Tf` operator below.
    const fontKey = outPage.node.newFontDictionary(font.name, font.ref);
    outPage.pushOperators(beginText(), setTextRenderingMode(TextRenderingMode.Invisible));

    for (const word of words) {
      const text = word.text.trim();
      if (!text) continue;
      let encoded: ReturnType<typeof font.encodeText>;
      try {
        encoded = font.encodeText(text);
      } catch {
        continue; // non-encodable characters — skip this word, keep the rest of the layer
      }
      const { x, y, size } = mapWordBoxToPdfSpace(word.bbox, rendered);
      outPage.pushOperators(
        setFontAndSize(fontKey, size),
        setTextMatrix(1, 0, 0, 1, x, y),
        showText(encoded),
      );
    }

    outPage.pushOperators(endText());
  }

  return doc.save();
}
