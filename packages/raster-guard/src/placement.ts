/**
 * Placement: find the page's genuinely empty horizontal bands and put the
 * notice in them.
 *
 * Existing hidden-instruction tooling stamps at a fixed offset (bottom-left,
 * some margin) and hopes. That collides with footers, page numbers and
 * full-bleed figures, and a collision is exactly what makes a reader look
 * twice. Raster Guard rasterizes the page itself, so it already knows every
 * text box on it — the notice can be placed where the document has no content
 * at all, which is both invisible in the ordinary sense and never overlaps.
 *
 * A band is treated as free only when **no** content intersects that
 * horizontal slice of the page. That is deliberately conservative: it costs
 * some usable space on busy pages and never produces an overlap.
 */

import type { PageLayout, Rect } from "./types";

/** A maximal run of content-free rows, in points from the top of the page. */
export interface FreeBand {
  top: number;
  bottom: number;
  height: number;
}

export interface FindFreeBandsOptions {
  /** Scan granularity in points. Smaller finds tighter bands and costs more time. Default 2. */
  rowHeightPt?: number;
  /** Bands shorter than this are dropped. Default 8. */
  minHeightPt?: number;
  /** Content boxes are grown by this much on every side before scanning, so the notice never crowds real text. Default 3. */
  paddingPt?: number;
}

/** Content-free horizontal bands, tallest first. */
export function findFreeBands(page: PageLayout, options: FindFreeBandsOptions = {}): FreeBand[] {
  const rowHeight = options.rowHeightPt ?? 2;
  const minHeight = options.minHeightPt ?? 8;
  const padding = options.paddingPt ?? 3;

  if (page.heightPt <= 0 || rowHeight <= 0) return [];

  const rowCount = Math.ceil(page.heightPt / rowHeight);
  const occupiedRows = new Uint8Array(rowCount);

  for (const box of page.occupied) {
    const top = box.y - padding;
    const bottom = box.y + box.height + padding;
    if (bottom <= 0 || top >= page.heightPt) continue;
    const firstRow = Math.max(0, Math.floor(top / rowHeight));
    const lastRow = Math.min(rowCount - 1, Math.ceil(bottom / rowHeight) - 1);
    for (let row = firstRow; row <= lastRow; row++) occupiedRows[row] = 1;
  }

  const bands: FreeBand[] = [];
  let runStart: number | null = null;

  for (let row = 0; row <= rowCount; row++) {
    const isFree = row < rowCount && occupiedRows[row] === 0;
    if (isFree && runStart === null) runStart = row;
    if (!isFree && runStart !== null) {
      const top = runStart * rowHeight;
      const bottom = Math.min(page.heightPt, row * rowHeight);
      if (bottom - top >= minHeight) bands.push({ top, bottom, height: bottom - top });
      runStart = null;
    }
  }

  return bands.sort((a, b) => b.height - a.height);
}

export type BandPreference = "bottom" | "top" | "largest";

/**
 * Picks a band that fits `neededHeightPt`.
 *
 * `bottom`/`top` prefer the band nearest that page edge — where a reader
 * expects boilerplate and skips it — and fall back to the largest band that
 * fits when neither edge has room.
 */
export function pickBand(
  bands: FreeBand[],
  neededHeightPt: number,
  preference: BandPreference,
): FreeBand | null {
  const fitting = bands.filter((band) => band.height >= neededHeightPt);
  if (fitting.length === 0) return null;
  if (preference === "largest") return fitting[0] ?? null;

  const sorted = [...fitting].sort((a, b) =>
    preference === "bottom" ? b.top - a.top : a.top - b.top,
  );
  return sorted[0] ?? null;
}

/**
 * Removes a claimed vertical span from a band list, splitting any band it cuts
 * through.
 *
 * Rungs are placed one after another on the same page, and each one has to see
 * the space its predecessors already took. Without this, two rungs whose
 * preferences point at the same gap — a footer and a watermark on a page whose
 * only free space is the bottom margin — both "fit" it and paint on top of each
 * other.
 *
 * `gapPt` keeps a little air between two rungs that end up adjacent.
 */
export function claimBandSpan(
  bands: FreeBand[],
  top: number,
  bottom: number,
  options: { minHeightPt?: number; gapPt?: number } = {},
): FreeBand[] {
  const minHeight = options.minHeightPt ?? 8;
  const gap = options.gapPt ?? 4;
  const claimedTop = top - gap;
  const claimedBottom = bottom + gap;
  const remaining: FreeBand[] = [];

  for (const band of bands) {
    if (claimedBottom <= band.top || claimedTop >= band.bottom) {
      remaining.push(band);
      continue;
    }
    const above = { top: band.top, bottom: Math.min(band.bottom, claimedTop) };
    const below = { top: Math.max(band.top, claimedBottom), bottom: band.bottom };
    for (const piece of [above, below]) {
      const height = piece.bottom - piece.top;
      if (height >= minHeight) remaining.push({ ...piece, height });
    }
  }

  return remaining.sort((a, b) => b.height - a.height);
}

export interface BlockRectOptions {
  page: PageLayout;
  band: FreeBand;
  neededHeightPt: number;
  marginXPt: number;
  /** Where the block sits inside the band. Default "center". */
  anchor?: "top" | "center" | "bottom";
}

/** Turns a chosen band into the rectangle an instance paints into. */
export function blockRectInBand(options: BlockRectOptions): Rect {
  const { page, band, neededHeightPt, marginXPt } = options;
  const anchor = options.anchor ?? "center";
  const height = Math.min(neededHeightPt, band.height);
  const slack = band.height - height;
  const y =
    anchor === "top" ? band.top : anchor === "bottom" ? band.top + slack : band.top + slack / 2;

  return {
    x: marginXPt,
    y,
    width: Math.max(0, page.widthPt - marginXPt * 2),
    height,
  };
}

/**
 * The rotated strip along a page's outer edge.
 *
 * Returned in the instance's own pre-rotation frame: `width` runs along the
 * page's height and `height` is the strip's thickness, because the painter
 * rotates about the rect's top-left corner before drawing. The left edge is
 * the default — right-edge content (thumb tabs, revision bars) is rarer than
 * left-edge binding margins in assignment templates.
 */
export function edgeStripRect(page: PageLayout, thicknessPt: number, side: "left" | "right"): Rect {
  return {
    x: side === "left" ? thicknessPt : page.widthPt - thicknessPt,
    y: page.heightPt,
    width: page.heightPt,
    height: thicknessPt,
  };
}

/**
 * Bounding boxes of a page's own content, from PDF.js text items.
 *
 * The web layer passes `getTextContent()` items straight through: PDF.js gives
 * each item a 6-element transform whose `[4]`/`[5]` are the baseline origin in
 * PDF's bottom-left space, plus a `width`/`height` in the same units. This
 * flips them into the top-left convention the rest of this package uses.
 */
export function occupiedBoxesFromTextItems(
  items: readonly { transform: readonly number[]; width: number; height: number }[],
  pageHeightPt: number,
): Rect[] {
  const boxes: Rect[] = [];
  for (const item of items) {
    const originX = item.transform[4];
    const baselineY = item.transform[5];
    if (typeof originX !== "number" || typeof baselineY !== "number") continue;
    if (item.width <= 0 && item.height <= 0) continue;
    // `height` is the glyph box above the baseline; allow a descender below it.
    const ascent = item.height > 0 ? item.height : 10;
    const descent = ascent * 0.25;
    boxes.push({
      x: originX,
      y: pageHeightPt - (baselineY + ascent),
      width: Math.max(item.width, 1),
      height: ascent + descent,
    });
  }
  return boxes;
}
