import type { Position } from "@pdf-injection/contracts";
import type { PDFFont } from "pdf-lib";
import { ValidationError } from "./errors";

/** Default horizontal margin (pt) used when no explicit x is given. Matches PRD §14 manifest example. */
export const DEFAULT_MARGIN_X = 24;
/** Default bottom/top margin (pt) used when no explicit y is given. */
export const DEFAULT_MARGIN_Y = 10;

/**
 * Wraps `text` into lines that each fit within `maxWidth` at the given font
 * and size. Explicit `\n` characters are always honored as hard breaks;
 * within a paragraph, words are greedily packed onto each line.
 */
export function wrapTextToLines(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    let current = "";

    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (current.length === 0 || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
}

export interface LinePosition {
  x: number;
  y: number;
}

export interface TextBlockLayout {
  /** One entry per input line, in the same order, giving the baseline x/y for that line. */
  linePositions: LinePosition[];
  boundingBox: [number, number, number, number];
}

export interface LayoutTextBlockParams {
  pageWidth: number;
  pageHeight: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  position: Position;
  x?: number;
  y?: number;
  font: PDFFont;
}

/**
 * Computes baseline positions for a block of pre-wrapped lines according to
 * `position` (top / bottom / custom), plus the bounding box of the rendered
 * text (used for InjectPdfResult.boundingBox / PrivateManifest.injection.boundingBox).
 */
export function layoutTextBlock(params: LayoutTextBlockParams): TextBlockLayout {
  const { pageHeight, lines, fontSize, lineHeight, position, font } = params;

  let startX: number;
  let startY: number; // baseline of lines[0]

  if (position === "custom") {
    if (params.x === undefined || params.y === undefined) {
      throw new ValidationError("x and y are required when position is 'custom'");
    }
    startX = params.x;
    startY = params.y;
  } else if (position === "top") {
    startX = DEFAULT_MARGIN_X;
    startY = pageHeight - DEFAULT_MARGIN_Y - fontSize;
  } else {
    // bottom: stack lines upward from the bottom margin so the LAST line's baseline sits at DEFAULT_MARGIN_Y
    startX = DEFAULT_MARGIN_X;
    startY = DEFAULT_MARGIN_Y + Math.max(lines.length - 1, 0) * lineHeight;
  }

  const linePositions: LinePosition[] = lines.map((_, i) => ({
    x: startX,
    y: startY - i * lineHeight,
  }));

  if (lines.length === 0) {
    return { linePositions: [], boundingBox: [startX, startY, startX, startY] };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  lines.forEach((line, i) => {
    const width = font.widthOfTextAtSize(line, fontSize);
    const pos = linePositions[i] as LinePosition;
    const descent = fontSize * 0.2; // approximate descender allowance
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + width);
    minY = Math.min(minY, pos.y - descent);
    maxY = Math.max(maxY, pos.y + fontSize);
  });

  return { linePositions, boundingBox: [minX, minY, maxX, maxY] };
}

export interface ResolveBoxPositionParams {
  pageHeight: number;
  /** Kept for API symmetry with layoutTextBlock/callers; not used by the
   * position math below (only `height` affects the "top" branch). */
  width: number;
  height: number;
  position: Position;
  x?: number;
  y?: number;
}

/**
 * Resolves the bottom-left corner (x, y) of a FIXED-size box (an
 * annotation/widget `/Rect`, or a rasterized image's placement) according
 * to `position`, reusing the same margin constants as `layoutTextBlock`.
 * Unlike `layoutTextBlock`, the box's height is already known up front (not
 * derived from wrapped text lines) — this is the simpler, position-only
 * resolver shared by the round-3 probe injectors (freetext_annot /
 * acroform_field / image_only).
 */
export function resolveBoxPosition(params: ResolveBoxPositionParams): { x: number; y: number } {
  const { pageHeight, height, position } = params;

  if (position === "custom") {
    if (params.x === undefined || params.y === undefined) {
      throw new ValidationError("x and y are required when position is 'custom'");
    }
    return { x: params.x, y: params.y };
  }

  if (position === "top") {
    return { x: DEFAULT_MARGIN_X, y: pageHeight - DEFAULT_MARGIN_Y - height };
  }

  return { x: DEFAULT_MARGIN_X, y: DEFAULT_MARGIN_Y };
}
