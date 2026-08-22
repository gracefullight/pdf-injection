import type { InjectionMode, OverallStatus, QpdfStatus } from "./types";

/**
 * Diff threshold (changedPixelRatio) per injection mode.
 * PRD §13.4 / API contract "overall computation":
 *   threshold(white_text) = 1e-5 (0.001%)
 *   threshold(render_mode_3) = 1e-7 (0.00001%)
 *   threshold(visible_positive_control) = Infinity
 *   threshold(xmp_only) = 1e-7 (page content untouched — round 2 §0.1)
 */
export function diffThreshold(mode: InjectionMode): number {
  switch (mode) {
    case "white_text":
      return 1e-5;
    case "render_mode_3":
      return 1e-7;
    case "visible_positive_control":
      return Number.POSITIVE_INFINITY;
    case "xmp_only":
      return 1e-7;
  }
}

export interface OverallStatusParts {
  outputLoadPassed: boolean;
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  pdfJsRenderPassed: boolean | null;
  hiddenTextExtracted: boolean;
  changedPixelRatio: number | null;
  hasServerWarnings: boolean;
  qpdfStatus: QpdfStatus;
  /** null for every mode except "xmp_only". Required (must be true) for xmp_only, else FAIL. */
  metadataPayloadPresent: boolean | null;
}

/**
 * Overall status computation. API contract "overall computation" section
 * (round 2 §0.1 extends it for xmp_only):
 *
 * FAIL               if !outputLoadPassed || !pageCountPreserved || !pageGeometryPreserved || pdfJsRenderPassed === false
 *                    || (mode === white_text && !hiddenTextExtracted) || (changedPixelRatio !== null && changedPixelRatio > threshold(mode))
 *                    || (mode === xmp_only && metadataPayloadPresent !== true)
 * NOT_TESTED         if pdfJsRenderPassed === null (client validation not yet posted)
 * PASS_WITH_WARNINGS if any serverValidation.warnings, qpdfStatus === "warning", or (mode === render_mode_3 && !hiddenTextExtracted)
 * PASS               otherwise
 *
 * Note: for xmp_only, hiddenTextExtracted is NOT required (page content is
 * untouched by design) — only metadataPayloadPresent gates FAIL.
 */
export function computeOverall(parts: OverallStatusParts, mode: InjectionMode): OverallStatus {
  const threshold = diffThreshold(mode);

  const fails =
    !parts.outputLoadPassed ||
    !parts.pageCountPreserved ||
    !parts.pageGeometryPreserved ||
    parts.pdfJsRenderPassed === false ||
    (mode === "white_text" && !parts.hiddenTextExtracted) ||
    (parts.changedPixelRatio !== null && parts.changedPixelRatio > threshold) ||
    (mode === "xmp_only" && parts.metadataPayloadPresent !== true);

  if (fails) return "FAIL";

  if (parts.pdfJsRenderPassed === null) return "NOT_TESTED";

  const hasWarnings =
    parts.hasServerWarnings ||
    parts.qpdfStatus === "warning" ||
    (mode === "render_mode_3" && !parts.hiddenTextExtracted);

  if (hasWarnings) return "PASS_WITH_WARNINGS";

  return "PASS";
}
