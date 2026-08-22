// Shared PDF-page-to-PNG rasterization for print-to-pdf.ts and ocr.ts.
//
// Uses pdfjs-dist's legacy build with the native @napi-rs/canvas module
// resolved through pdfjs-dist's own require root (see native-canvas.ts for
// why). Confirmed working under Bun 1.3.14 (macOS arm64) via a spike prior
// to building this module: rendering plus `standardFontDataUrl` pointed at
// pdfjs-dist's bundled `standard_fonts/` directory (required for non-
// embedded standard fonts to rasterize glyphs; without it `page.render()`
// throws deep inside the operator-list executor).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { resolveNapiCanvas, resolveStandardFontDataUrl } from "./native-canvas";

export interface RenderedPage {
  pageIndex: number;
  /** Page size in PDF points (unscaled, i.e. viewport scale=1), for geometry preservation. */
  widthPt: number;
  heightPt: number;
  widthPx: number;
  heightPx: number;
  png: Buffer;
  /** The scale actually used for this page — may be less than the requested `scale` if it was reduced to stay within the pixel budget (see `maxRenderPixels`). */
  scaleUsed: number;
}

export interface RenderPagesResult {
  available: boolean;
  reason?: string;
  pages: RenderedPage[];
  pageCount: number;
}

/**
 * Default pixel-area budget per rendered page (width_px * height_px), ~50
 * megapixels. A @napi-rs/canvas allocation and its uncompressed RGBA buffer
 * scale directly with this; an unbounded `scale` on an attacker-controlled
 * PDF with an oversized MediaBox (PDF allows page dimensions up to 14400x14400pt)
 * is an easy memory-exhaustion vector for printToPdf/ocrRegenerate, both of
 * which run this per request. Cycle 3 QA fix (MEDIUM). Override per call via
 * `opts.maxRenderPixels`.
 */
export const DEFAULT_MAX_RENDER_PIXELS = 50_000_000;

/** Floor below which we stop reducing scale and report the page as unrenderable, rather than producing an illegibly tiny image. */
const MIN_RENDER_SCALE = 0.25;

/**
 * Picks the scale to actually render a page at: `requestedScale` if its
 * pixel area already fits the budget, otherwise the largest scale <=
 * `requestedScale` that fits — down to `MIN_RENDER_SCALE`. Returns `null`
 * when even `MIN_RENDER_SCALE` would exceed the budget (page too large to
 * render safely at any usable resolution).
 */
function pickRenderScale(
  widthPt: number,
  heightPt: number,
  requestedScale: number,
  maxRenderPixels: number,
): number | null {
  const areaAtRequested = widthPt * requestedScale * (heightPt * requestedScale);
  if (areaAtRequested <= maxRenderPixels) return requestedScale;

  // area(scale) = (widthPt*heightPt) * scale^2 -> solve for the scale where area == budget.
  const areaAtScale1 = widthPt * heightPt;
  const fittingScale = Math.sqrt(maxRenderPixels / areaAtScale1);
  if (fittingScale < MIN_RENDER_SCALE) return null;
  return Math.min(fittingScale, requestedScale);
}

/**
 * Renders every page of `bytes` to a PNG buffer at the given scale.
 * `available: false` (with `reason`) when the @napi-rs/canvas native module
 * cannot be loaded, or when a page is too large to render within
 * `maxRenderPixels` even at `MIN_RENDER_SCALE` (0.25) — never throws for
 * either case.
 */
export async function renderPagesToPng(
  bytes: Uint8Array,
  opts: { scale?: number; maxRenderPixels?: number } = {},
): Promise<RenderPagesResult> {
  const requestedScale = opts.scale ?? 2;
  const maxRenderPixels = opts.maxRenderPixels ?? DEFAULT_MAX_RENDER_PIXELS;
  const { module: canvasModule, reason: canvasReason } = await resolveNapiCanvas();
  if (!canvasModule) {
    return {
      available: false,
      reason: canvasReason ?? "canvas unavailable",
      pages: [],
      pageCount: 0,
    };
  }

  const loadingTask = pdfjsLib.getDocument({
    // pdfjs explicitly rejects `Buffer` instances (it wants a plain
    // Uint8Array) even though Buffer is a Uint8Array subclass at runtime —
    // callers commonly hand us the return value of node:fs readFile, which
    // is a Buffer, so normalize defensively rather than pushing this onto
    // every call site.
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: resolveStandardFontDataUrl(),
  });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages: RenderedPage[] = [];

  for (let i = 0; i < pageCount; i++) {
    const page = await pdf.getPage(i + 1); // pdfjs pages are 1-based
    const unscaledViewport = page.getViewport({ scale: 1 });

    const pageScale = pickRenderScale(
      unscaledViewport.width,
      unscaledViewport.height,
      requestedScale,
      maxRenderPixels,
    );
    if (pageScale === null) {
      await pdf.destroy();
      return {
        available: false,
        reason: `page ${i} is too large to render safely: ${Math.round(unscaledViewport.width)}x${Math.round(unscaledViewport.height)}pt exceeds the ${maxRenderPixels.toLocaleString()}px^2 budget even at the minimum ${MIN_RENDER_SCALE}x scale`,
        pages: [],
        pageCount: 0,
      };
    }

    const viewport = page.getViewport({ scale: pageScale });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    const renderTask = page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    });
    await renderTask.promise;

    pages.push({
      pageIndex: i,
      widthPt: unscaledViewport.width,
      heightPt: unscaledViewport.height,
      widthPx: canvas.width,
      heightPx: canvas.height,
      png: canvas.toBuffer("image/png"),
      scaleUsed: pageScale,
    });
  }

  await pdf.destroy();

  return { available: true, pages, pageCount };
}
