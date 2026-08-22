import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import * as pdfjsLib from "pdfjs-dist";

// Vite-friendly worker configuration (module worker, hashed URL at dev/build time).
pdfjsLib.GlobalWorkerOptions.workerPort = null as unknown as Worker;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type { PDFDocumentProxy, PDFPageProxy };

export const pdfJsVersion: string = pdfjsLib.version;

/** Load a PDF from raw bytes. Caller owns the returned proxy and must call `.destroy()` when done. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdfjs detaches/transfers the buffer it's given; pass a copy so callers can reuse `bytes`.
  const copy = bytes.slice();
  const task = pdfjsLib.getDocument({
    data: copy,
    isEvalSupported: false,
    disableFontFace: false,
  });
  return task.promise;
}

export interface RenderPageOptions {
  scale?: number;
  /** Fill the canvas with white before rendering (matches the PRD §13.4 visual-diff baseline). */
  whiteBackground?: boolean;
}

/** Render a PDF.js page to a fresh canvas. Default scale 2, white background, RGBA. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  options: RenderPageOptions = {},
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 2;
  const whiteBackground = options.whiteBackground ?? true;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Could not acquire 2D canvas context for PDF render");
  }

  if (whiteBackground) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

export interface ExtractedPageText {
  text: string;
  items: number;
}

/** Extract concatenated text content for a page via PDF.js `getTextContent()`. */
export async function extractPageText(page: PDFPageProxy): Promise<ExtractedPageText> {
  const content = await page.getTextContent();
  const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  return { text, items: content.items.length };
}

export interface DocumentInfo {
  pageCount: number;
  pdfJsVersion: string;
  encrypted: boolean;
  hasSignatureHint: boolean;
  fingerprint: string | null;
}

/**
 * Best-effort document info: page count always available; encryption/signature
 * detection relies on PDF.js metadata heuristics (not a guarantee — the server
 * is the source of truth for INVALID_PDF/PDF_ENCRYPTED/PDF_SIGNED).
 */
export async function getDocumentInfo(doc: PDFDocumentProxy): Promise<DocumentInfo> {
  let encrypted = false;
  let hasSignatureHint = false;
  let fingerprint: string | null = null;

  try {
    const metadata = await doc.getMetadata();
    const info = metadata.info as Record<string, unknown> | undefined;
    if (info) {
      encrypted = Boolean(info.IsEncrypted ?? info.EncryptFilterName);
      hasSignatureHint = Boolean(info.IsAcroFormPresent) && Boolean(info.IsSignaturesPresent);
    }
  } catch {
    // metadata read failures are non-fatal for a best-effort client-side hint
  }

  try {
    fingerprint = doc.fingerprints?.[0] ?? null;
  } catch {
    fingerprint = null;
  }

  return {
    pageCount: doc.numPages,
    pdfJsVersion: pdfjsLib.version,
    encrypted,
    hasSignatureHint,
    fingerprint,
  };
}

/** Magic-bytes check (`%PDF-`) — first line of client-side validation before upload. */
export function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  const header = bytes.subarray(0, 5);
  const expected = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  return expected.every((byte, index) => header[index] === byte);
}
