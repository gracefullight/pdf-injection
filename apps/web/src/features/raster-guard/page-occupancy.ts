import {
  occupiedBoxesFromTextItems,
  type PageLayout,
  type Rect,
} from "@pdf-injection/raster-guard";
import type { PDFPageProxy } from "@/lib/pdfjs";

/**
 * Reads a page's own content boxes so the planner can place the notice where
 * the document has nothing.
 *
 * Two sources are merged. Text items give precise boxes for the body copy.
 * Anything drawn rather than typed — a figure, a table rule, a full-bleed
 * header image — has no text item, so pages are additionally checked against
 * their rendered pixels by the caller (`inkBoxesFromImageData`), and both sets
 * of boxes go into the same `occupied` list.
 */

interface TextItemLike {
  transform?: number[];
  width?: number;
  height?: number;
}

/** Builds a `PageLayout` from a PDF.js page's text content. */
export async function readPageLayout(page: PDFPageProxy, pageIndex: number): Promise<PageLayout> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const items = content.items
    .map((item) => item as TextItemLike)
    .filter(
      (item): item is { transform: number[]; width: number; height: number } =>
        Array.isArray(item.transform) &&
        typeof item.width === "number" &&
        typeof item.height === "number",
    );

  return {
    pageIndex,
    widthPt: viewport.width,
    heightPt: viewport.height,
    occupied: occupiedBoxesFromTextItems(items, viewport.height),
  };
}

export interface InkScanOptions {
  /** Pixels per point the image was rendered at. */
  rasterScale: number;
  /** Rows this many points tall are tested together. Default 4. */
  rowHeightPt?: number;
  /** A row counts as inked once this share of its pixels differ from white. Default 0.002. */
  inkRatioThreshold?: number;
}

/**
 * Finds the rows of a rendered page that carry ink of any kind.
 *
 * Text extraction misses figures, scanned pages and vector drawings entirely —
 * and a scanned assignment has *no* text items at all, which would otherwise
 * make the whole page look free and put the notice straight over the content.
 * Scanning the pixels closes that hole: a row with ink is occupied, whatever
 * drew it.
 *
 * Returns full-width boxes, since the planner works in horizontal bands.
 */
export function inkBoxesFromImageData(
  image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  pageWidthPt: number,
  pageHeightPt: number,
  options: InkScanOptions,
): Rect[] {
  const rowHeightPt = options.rowHeightPt ?? 4;
  const threshold = options.inkRatioThreshold ?? 0.002;
  if (image.width <= 0 || image.height <= 0 || pageHeightPt <= 0) return [];

  const rowHeightPx = Math.max(1, Math.round(rowHeightPt * options.rasterScale));
  const boxes: Rect[] = [];

  for (let top = 0; top < image.height; top += rowHeightPx) {
    const bottom = Math.min(image.height, top + rowHeightPx);
    let inked = 0;
    let sampled = 0;

    for (let y = top; y < bottom; y++) {
      for (let x = 0; x < image.width; x++) {
        const offset = (y * image.width + x) * 4;
        const r = image.data[offset] ?? 255;
        const g = image.data[offset + 1] ?? 255;
        const b = image.data[offset + 2] ?? 255;
        sampled++;
        // 246 rather than 255: JPEG ringing and anti-aliasing leave near-white
        // noise on an otherwise blank page, and counting that as ink would
        // mark every row occupied.
        if (r < 246 || g < 246 || b < 246) inked++;
      }
    }

    if (sampled > 0 && inked / sampled >= threshold) {
      boxes.push({
        x: 0,
        y: (top / image.height) * pageHeightPt,
        width: pageWidthPt,
        height: ((bottom - top) / image.height) * pageHeightPt,
      });
    }
  }

  return boxes;
}

/** Mean luminance of a rectangle of the rendered page, as `#rrggbb` grey — the paper colour the notice will sit on. */
export function sampleBackgroundHex(
  image: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  rectPt: Rect,
  pageWidthPt: number,
  pageHeightPt: number,
): string {
  if (image.width <= 0 || image.height <= 0 || pageWidthPt <= 0 || pageHeightPt <= 0) {
    return "#ffffff";
  }

  const x0 = clampIndex((rectPt.x / pageWidthPt) * image.width, image.width);
  const x1 = clampIndex(((rectPt.x + rectPt.width) / pageWidthPt) * image.width, image.width);
  const y0 = clampIndex((rectPt.y / pageHeightPt) * image.height, image.height);
  const y1 = clampIndex(((rectPt.y + rectPt.height) / pageHeightPt) * image.height, image.height);
  if (x1 <= x0 || y1 <= y0) return "#ffffff";

  let total = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const offset = (y * image.width + x) * 4;
      const r = image.data[offset] ?? 255;
      const g = image.data[offset + 1] ?? 255;
      const b = image.data[offset + 2] ?? 255;
      total += (r + g + b) / 3;
      count++;
    }
  }

  const mean = count > 0 ? Math.round(total / count) : 255;
  const channel = Math.min(255, Math.max(0, mean)).toString(16).padStart(2, "0");
  return `#${channel}${channel}${channel}`;
}

function clampIndex(value: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(value)));
}
