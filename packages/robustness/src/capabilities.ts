// Lazily probes and caches whether this process can actually render PDF
// pages (via @napi-rs/canvas, resolved through pdfjs-dist's own require
// root — see native-canvas.ts) and run OCR (via tesseract.js, which needs
// its "eng" trained-data file, downloaded over the network on first use and
// cached under DEFAULT_TESSDATA_CACHE_PATH thereafter). Consumed by
// apps/api's `GET /health` (`features.canvasAvailable` /
// `features.ocrAvailable`, per contract §0.2) and by the robustness run
// pipeline to short-circuit with a documented `available:false` + reason
// instead of throwing.
import { resolveNapiCanvas } from "./native-canvas";
import { getOcrWorker } from "./ocr";

export interface Capabilities {
  canvas: boolean;
  ocr: boolean;
  reasons: Record<string, string>;
}

let cached: Promise<Capabilities> | null = null;

async function probe(): Promise<Capabilities> {
  const reasons: Record<string, string> = {};

  const { module: canvasModule, reason: canvasReason } = await resolveNapiCanvas();
  let canvas = canvasModule !== null;
  if (canvas && canvasModule) {
    // Confirm the module is actually usable (not just importable) by
    // creating and immediately discarding a 1x1 canvas.
    try {
      const probeCanvas = canvasModule.createCanvas(1, 1);
      canvas =
        typeof probeCanvas.getContext("2d") === "object" ||
        typeof probeCanvas.getContext("2d") === "function";
    } catch (err) {
      canvas = false;
      reasons.canvas = `@napi-rs/canvas failed a 1x1 canvas smoke test: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (!canvas && !reasons.canvas) {
    reasons.canvas = canvasReason ?? "canvas unavailable";
  }

  const { worker, reason: ocrReason } = await getOcrWorker("eng");
  const ocr = worker !== null;
  if (!ocr) {
    reasons.ocr = ocrReason ?? "ocr unavailable";
  }

  return { canvas, ocr, reasons };
}

/**
 * Returns (and caches) whether canvas rendering and OCR are available in
 * this process. The first call may take longer for `ocr` if the "eng"
 * trained-data language file isn't cached yet (network fetch); subsequent
 * calls resolve instantly from the cached promise.
 */
export function capabilities(): Promise<Capabilities> {
  if (!cached) {
    cached = probe();
  }
  return cached;
}

/** Test-only: forces the next `capabilities()` call to re-probe. */
export function __resetCapabilitiesCacheForTests(): void {
  cached = null;
}
