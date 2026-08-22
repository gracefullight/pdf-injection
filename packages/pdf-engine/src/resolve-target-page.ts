import type { TargetPage } from "@pdf-injection/contracts";
import { ValidationError } from "./errors";

/**
 * Resolves a TargetPage ("first" | "last" | 1-based integer) to a 0-based
 * pageIndex for a document with `pageCount` pages. Throws a typed
 * ValidationError (ApiErrorCode VALIDATION_ERROR) on out-of-range input so
 * callers can map it 1:1 to the error envelope.
 */
export function resolveTargetPage(targetPage: TargetPage, pageCount: number): number {
  if (pageCount <= 0) {
    throw new ValidationError("Cannot resolve a target page in a document with zero pages");
  }

  if (targetPage === "first") return 0;
  if (targetPage === "last") return pageCount - 1;

  if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > pageCount) {
    throw new ValidationError(
      `targetPage ${targetPage} is out of range for a ${pageCount}-page document (expected 1..${pageCount})`,
    );
  }

  return targetPage - 1;
}
