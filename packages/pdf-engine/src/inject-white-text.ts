import type { Position } from "@pdf-injection/contracts";
import { type PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";

export interface InjectWhiteTextInput {
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

export interface InjectTextResult {
  boundingBox: [number, number, number, number];
  fontSize: number;
}

/**
 * WT-01 — inserts white (invisible-by-color) text on the target page.
 * PRD §10.3: uses pdf-lib's standard drawText/font-embedding path, fill
 * color rgb(1,1,1), default fontSize 1.
 */
export async function injectWhiteText(input: InjectWhiteTextInput): Promise<InjectTextResult> {
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

    lines.forEach((line, i) => {
      const pos = layout.linePositions[i];
      if (!pos) return;
      page.drawText(line, { x: pos.x, y: pos.y, size: fontSize, font, color: rgb(1, 1, 1) });
    });

    return { boundingBox: layout.boundingBox, fontSize };
  } catch (err) {
    // Already-typed errors (e.g. ValidationError from layoutTextBlock) carry
    // their own ApiErrorCode — propagate them as-is instead of masking them
    // behind INJECTION_FAILED.
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`white_text injection failed: ${(err as Error).message}`);
  }
}
