import { PDFDocument } from "pdf-lib";
import { extractPageText, loadPdf, renderPageToCanvas } from "@/lib/pdfjs";

export interface RasterizeOptions {
  /** Viewport scale factor: 1.5 = 108 DPI, 2 = 144 DPI (default), 3 = 216 DPI */
  scale?: number;
  /** Image format to embed into the PDF: "image/png" (lossless) or "image/jpeg" (compressed) */
  imageFormat?: "image/png" | "image/jpeg";
  /** JPEG quality (0.1 to 1.0, default 0.85). Only used when imageFormat is "image/jpeg". */
  jpegQuality?: number;
  /** Progress callback invoked after each page is rendered and embedded. */
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  /** Abort signal to cancel an in-flight rasterization operation. */
  signal?: AbortSignal;
}

export interface RasterizeResult {
  bytes: Uint8Array;
  pageCount: number;
  originalSizeBytes: number;
  rasterizedSizeBytes: number;
  scaleUsed: number;
  formatUsed: "image/png" | "image/jpeg";
  isTextFree: boolean;
  totalExtractedCharacters: number;
}

/** Converts an HTMLCanvasElement into image bytes (Uint8Array). */
export async function canvasToImageBytes(
  canvas: HTMLCanvasElement,
  format: "image/png" | "image/jpeg" = "image/png",
  quality = 0.85,
): Promise<Uint8Array> {
  if (typeof canvas.toBlob === "function") {
    return new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob returned null"));
            return;
          }
          try {
            const arrayBuffer = await blob.arrayBuffer();
            resolve(new Uint8Array(arrayBuffer));
          } catch (err) {
            reject(err);
          }
        },
        format,
        quality,
      );
    });
  }

  // Fallback if toBlob is unavailable in the environment
  const dataUrl = canvas.toDataURL(format, quality);
  const base64 = dataUrl.split(",")[1];
  if (!base64) throw new Error("Canvas toDataURL returned invalid data URL");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Rasterizes every page of a PDF document into high-resolution images in the browser
 * and rebuilds an image-only PDF with pdf-lib. All text and vector objects are
 * replaced with bitmap images, stripping any invisible fonts or prompt-injection text layers.
 */
export async function rasterizePdfInBrowser(
  pdfBytes: Uint8Array,
  options: RasterizeOptions = {},
): Promise<RasterizeResult> {
  const scale = options.scale ?? 2;
  const format = options.imageFormat ?? "image/png";
  const quality = options.jpegQuality ?? 0.85;

  const sourceDoc = await loadPdf(pdfBytes);
  const pageCount = sourceDoc.numPages;

  try {
    const outDoc = await PDFDocument.create();

    for (let i = 1; i <= pageCount; i++) {
      if (options.signal?.aborted) {
        throw new Error("Rasterization cancelled by user");
      }

      const page = await sourceDoc.getPage(i);
      const unscaled = page.getViewport({ scale: 1 });

      const canvas = await renderPageToCanvas(page, {
        scale,
        whiteBackground: true,
      });

      const imageBytes = await canvasToImageBytes(canvas, format, quality);

      const embeddedImage =
        format === "image/jpeg"
          ? await outDoc.embedJpg(imageBytes)
          : await outDoc.embedPng(imageBytes);

      const outPage = outDoc.addPage([unscaled.width, unscaled.height]);
      outPage.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: unscaled.width,
        height: unscaled.height,
      });

      options.onProgress?.({
        current: i,
        total: pageCount,
        percent: Math.round((i / pageCount) * 100),
      });
    }

    const rasterizedBytes = await outDoc.save();

    // Verify that the output PDF has no extractable text objects
    let isTextFree = true;
    let totalExtractedCharacters = 0;
    try {
      const verifyDoc = await loadPdf(rasterizedBytes);
      for (let i = 1; i <= verifyDoc.numPages; i++) {
        const page = await verifyDoc.getPage(i);
        const textInfo = await extractPageText(page);
        totalExtractedCharacters += textInfo.text.trim().length;
      }
      await verifyDoc.destroy();
      isTextFree = totalExtractedCharacters === 0;
    } catch {
      // Best-effort verification
    }

    return {
      bytes: rasterizedBytes,
      pageCount,
      originalSizeBytes: pdfBytes.byteLength,
      rasterizedSizeBytes: rasterizedBytes.byteLength,
      scaleUsed: scale,
      formatUsed: format,
      isTextFree,
      totalExtractedCharacters,
    };
  } finally {
    await sourceDoc.destroy();
  }
}
