import type { Position } from "@pdf-injection/contracts";
import { type PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";

const VISIBLE_CONTROL_FONT_SIZE = 9;

export interface InjectVisibleControlInput {
  doc: PDFDocument;
  pageIndex: number;
  instruction: string;
  position: Position;
  x?: number;
  y?: number;
  /** Ignored — visible_positive_control always renders at 9pt (API contract). */
  fontSize?: number;
  maxWidth?: number;
  /** Custom font (e.g. embedded Noto Sans KR subset for payloadLanguage "ko"); defaults to Helvetica. */
  font?: PDFFont;
}

/**
 * Visible positive control — draws the same instruction text, but visibly
 * (black, fontSize fixed at 9pt regardless of requested fontSize). PRD §10.5.
 * Research-only condition, never intended for real student distribution.
 */
export async function injectVisibleControl(
  input: InjectVisibleControlInput,
): Promise<InjectTextResult> {
  try {
    const page = input.doc.getPage(input.pageIndex);
    const font = input.font ?? (await input.doc.embedFont(StandardFonts.Helvetica));
    const fontSize = VISIBLE_CONTROL_FONT_SIZE;
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
      page.drawText(line, { x: pos.x, y: pos.y, size: fontSize, font, color: rgb(0, 0, 0) });
    });

    return { boundingBox: layout.boundingBox, fontSize };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(
      `visible_positive_control injection failed: ${(err as Error).message}`,
    );
  }
}
