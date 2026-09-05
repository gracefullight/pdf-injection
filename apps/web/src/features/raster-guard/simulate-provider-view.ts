import { type ProviderProfile, providerImageScale } from "@pdf-injection/raster-guard";

/**
 * "What the model sees": resample a guarded page exactly the way a provider's
 * ingestion would, so the prediction in the coverage report can be checked with
 * an eye instead of trusted.
 *
 * A number saying the cap height survives at 9.4px is easy to write and hard to
 * believe. Rendering the page at the provider's own effective resolution and
 * showing it at 1:1 makes the claim falsifiable by looking at it, which is the
 * cheapest verification available before spending a real API call.
 */

export interface ProviderTargetSize {
  width: number;
  height: number;
  /** Resample factor applied to the source raster. Never above 1. */
  scale: number;
}

/**
 * The pixel size a provider's pipeline reduces a page raster to.
 *
 * Delegates the arithmetic to `providerImageScale()` in
 * `@pdf-injection/raster-guard` so the preview and the coverage prediction are
 * computed from one definition rather than two copies that can drift.
 */
export function providerTargetSize(
  profile: ProviderProfile,
  sourceWidthPx: number,
  sourceHeightPx: number,
): ProviderTargetSize {
  if (sourceWidthPx <= 0 || sourceHeightPx <= 0) return { width: 0, height: 0, scale: 1 };

  const scale = providerImageScale(profile, sourceWidthPx, sourceHeightPx);

  // Floored, not rounded: rounding both edges up can push the result back over
  // a budget the scale factor was computed specifically to satisfy.
  return {
    width: Math.max(1, Math.floor(sourceWidthPx * scale)),
    height: Math.max(1, Math.floor(sourceHeightPx * scale)),
    scale,
  };
}

export interface ProviderViewOptions {
  /** Re-encode as JPEG at this quality after resampling, mimicking a lossy pipeline. Skipped when omitted. */
  jpegQuality?: number;
}

/**
 * Resamples a rendered page to a provider's effective geometry.
 *
 * The JPEG round trip is what makes a faint watermark's risk visible: bilinear
 * downscaling alone preserves low-contrast ink almost perfectly, and it is the
 * quantizer that flattens it into the paper.
 */
export async function renderProviderView(
  source: HTMLCanvasElement,
  profile: ProviderProfile,
  options: ProviderViewOptions = {},
): Promise<HTMLCanvasElement> {
  const target = providerTargetSize(profile, source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Could not acquire a 2D canvas context for the provider preview");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (options.jpegQuality === undefined) return canvas;
  return jpegRoundTrip(canvas, options.jpegQuality);
}

/** Encodes to JPEG and decodes back, so the preview carries the same quantization artifacts the model receives. */
async function jpegRoundTrip(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<HTMLCanvasElement> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!blob || typeof createImageBitmap !== "function") return canvas;

  const bitmap = await createImageBitmap(blob);
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
