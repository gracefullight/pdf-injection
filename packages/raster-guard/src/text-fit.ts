/**
 * Font-metric-free text fitting.
 *
 * Planning happens before any canvas exists, so it cannot call `measureText`.
 * These helpers estimate with a mean advance ratio, which is accurate enough to
 * choose a band and a font size; the painter re-wraps with the real metrics
 * before drawing, so an estimate that is a few percent off costs nothing.
 *
 * A few percent is the tolerance; a third is not. All-capital text is far wider
 * per character than mixed-case prose — Helvetica Bold's caps run about 0.72em
 * against roughly 0.5em for a mixed-case average — so estimating a headline at
 * the prose ratio sizes it about 35% too large and it silently wraps out of the
 * band reserved for it. Hence two ratios, and a caller that picks.
 */

/** Mean advance width as a fraction of font size for mixed-case sans-serif prose. */
export const AVG_ADVANCE_RATIO = 0.5;

/** Mean advance width for all-capital sans-serif text, spaces and punctuation included. */
export const CAPS_ADVANCE_RATIO = 0.68;

/** The ratio to estimate `text` with, chosen from whether it is set in capitals. */
export function advanceRatioFor(text: string): number {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return AVG_ADVANCE_RATIO;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8 ? CAPS_ADVANCE_RATIO : AVG_ADVANCE_RATIO;
}

/** Estimated rendered width of a single line, in points. */
export function estimateTextWidthPt(
  text: string,
  fontSizePt: number,
  advanceRatio: number = AVG_ADVANCE_RATIO,
): number {
  return text.length * fontSizePt * advanceRatio;
}

/** Estimated font size at which `text` fills exactly `widthPt` on one line. */
export function fontSizeToFitWidthPt(
  text: string,
  widthPt: number,
  advanceRatio: number = AVG_ADVANCE_RATIO,
): number {
  if (text.length === 0) return 0;
  return widthPt / (text.length * advanceRatio);
}

/**
 * Greedy word wrap against the estimated metric. Hard `\n` breaks are always
 * honoured, matching `wrapTextToLines()` in `packages/pdf-engine` so a notice
 * lays out the same way whichever engine draws it.
 */
export function estimateWrappedLines(
  text: string,
  fontSizePt: number,
  maxWidthPt: number,
  advanceRatio: number = AVG_ADVANCE_RATIO,
): string[] {
  const lines: string[] = [];

  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    let current = "";
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (
        current.length === 0 ||
        estimateTextWidthPt(candidate, fontSizePt, advanceRatio) <= maxWidthPt
      ) {
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

/** Estimated height of a wrapped block, in points. */
export function estimateBlockHeightPt(
  text: string,
  fontSizePt: number,
  lineHeightPt: number,
  maxWidthPt: number,
  advanceRatio: number = AVG_ADVANCE_RATIO,
): number {
  return estimateWrappedLines(text, fontSizePt, maxWidthPt, advanceRatio).length * lineHeightPt;
}
