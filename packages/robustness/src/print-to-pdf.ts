// Renders every page to a PNG image (render-pages.ts) and rebuilds an
// image-only PDF with pdf-lib, one page per source page, sized in PDF points
// identically to the source page (geometry preserved) with the rendered PNG
// filling the full page. Simulates the "print to PDF" robustness attack: any
// text-layer payload (white_text, render_mode_3, xmp_only, unicode_tags) is
// gone from the output because there is no text content stream at all, only
// an image XObject.
import { PDFDocument } from "pdf-lib";
import { renderPagesToPng } from "./render-pages";

export interface PrintToPdfResult {
  available: boolean;
  reason?: string;
  bytes?: Uint8Array;
  pageCount?: number;
}

export async function printToPdf(
  bytes: Uint8Array,
  opts: { scale?: number; maxRenderPixels?: number } = {},
): Promise<PrintToPdfResult> {
  const scale = opts.scale ?? 2;
  const rendered = await renderPagesToPng(bytes, { scale, maxRenderPixels: opts.maxRenderPixels });
  if (!rendered.available) {
    return { available: false, reason: rendered.reason ?? "canvas unavailable for print-to-pdf" };
  }

  const outDoc = await PDFDocument.create();
  for (const page of rendered.pages) {
    const pngImage = await outDoc.embedPng(page.png);
    const outPage = outDoc.addPage([page.widthPt, page.heightPt]);
    outPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: page.widthPt,
      height: page.heightPt,
    });
  }

  const outBytes = await outDoc.save();
  return { available: true, bytes: outBytes, pageCount: rendered.pages.length };
}
