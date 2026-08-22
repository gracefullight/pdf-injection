import type { PdfTransform, ProviderName, RunStatus, TextTransform } from "@pdf-injection/contracts";

export const ALL_PDF_TRANSFORMS: PdfTransform[] = ["print_to_pdf", "ocr_regeneration"];
export const ALL_TEXT_TRANSFORMS: TextTransform[] = ["paraphrase", "translation", "human_edit"];

const TERMINAL_RUN_STATUSES: RunStatus[] = ["completed", "failed", "cancelled"];

/** Shared with model-test's polling logic conceptually, kept local so this feature has no
 * dependency on `features/model-test/**` (own-file boundary between r6's two owned features). */
export function shouldPollRun(status: RunStatus | null | undefined): boolean {
  if (!status) return false;
  return !TERMINAL_RUN_STATUSES.includes(status);
}

export function formatPercent(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function availabilityLabel(available: boolean, reason?: string | null): string {
  if (available) return "Available";
  return reason ? `Unavailable — ${reason}` : "Unavailable";
}

export function geometryLabel(preserved: boolean | null): string {
  if (preserved === null) return "—";
  return preserved ? "Preserved" : "Changed";
}

/** Whether a PDF transform checkbox should be selectable given server capability flags. */
export function pdfTransformAvailability(
  transform: PdfTransform,
  features: { canvasAvailable: boolean; ocrAvailable: boolean },
): { available: boolean; reason: string | null } {
  if (transform === "print_to_pdf" && !features.canvasAvailable) {
    return { available: false, reason: "PDF rendering (canvas) is not available on this server." };
  }
  if (transform === "ocr_regeneration" && (!features.canvasAvailable || !features.ocrAvailable)) {
    return { available: false, reason: "OCR or PDF rendering is not available on this server." };
  }
  return { available: true, reason: null };
}

export function providerAvailability(
  provider: ProviderName,
  features: { externalProviders: boolean },
): { available: boolean; reason: string | null } {
  if (provider === "mock") return { available: true, reason: null };
  if (!features.externalProviders) {
    return {
      available: false,
      reason: "External providers disabled — set PS_ALLOW_EXTERNAL_PROVIDERS=true to enable.",
    };
  }
  return { available: true, reason: null };
}

/** Splits a textarea's newline-separated content into non-empty, trimmed sample texts. */
export function parseCustomTexts(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
