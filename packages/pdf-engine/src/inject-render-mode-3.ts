import type { Position } from "@pdf-injection/contracts";
import {
  beginText,
  endText,
  type PDFDocument,
  type PDFFont,
  StandardFonts,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";

export interface InjectRenderMode3Input {
  doc: PDFDocument;
  pageIndex: number;
  instruction: string;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  /** Custom font (e.g. embedded Noto Sans KR subset for payloadLanguage "ko"); defaults to Helvetica. */
  font?: PDFFont;
}

/**
 * TR-03 — inserts text with PDF text rendering mode 3 (invisible; glyphs are
 * neither filled nor stroked). Uses pdf-lib's low-level operator API so the
 * output content stream literally contains `3 Tr`. PRD §10.4.
 */
export async function injectRenderMode3(input: InjectRenderMode3Input): Promise<InjectTextResult> {
  try {
    const page = input.doc.getPage(input.pageIndex);
    const font = input.font ?? (await input.doc.embedFont(StandardFonts.Helvetica));
    const fontSize = input.fontSize ?? 1;
    const lineHeight = fontSize * 1.2;
    const maxWidth = input.maxWidth ?? page.getWidth() - 2 * DEFAULT_MARGIN_X;

    const lines = wrapTextToLines(input.instruction, font, fontSize, maxWidth);
    const layout = layoutTextBlock({
      pageWidth: page.getWidth(),
      pageHeight: page.getHeight(),
      lines,
      fontSize,
      lineHeight,
      maxWidth,
      position: input.position,
      x: input.x,
      y: input.y,
      font,
    });

    // Registers the font in the page's /Resources /Font dict and returns its
    // resource key (e.g. /F1) for use in the raw `Tf` operator below.
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    page.pushOperators(
      beginText(),
      setFontAndSize(fontKey, fontSize),
      setTextRenderingMode(TextRenderingMode.Invisible),
    );

    lines.forEach((line, i) => {
      const pos = layout.linePositions[i];
      if (!pos) return;
      page.pushOperators(setTextMatrix(1, 0, 0, 1, pos.x, pos.y), showText(font.encodeText(line)));
    });

    page.pushOperators(endText());

    return { boundingBox: layout.boundingBox, fontSize };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`render_mode_3 injection failed: ${(err as Error).message}`);
  }
}
