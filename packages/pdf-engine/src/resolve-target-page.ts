import type { TargetPage } from "@pdf-injection/contracts";
import { ValidationError } from "./errors";

/**
 * Resolves a TargetPage ("first" | "last" | "all" | 1-based integer) to the
 * ascending list of 0-based page indexes to inject on, for a document with
 * `pageCount` pages. Every value but `"all"` yields exactly one index; `"all"`
 * yields every page. Throws a typed ValidationError (ApiErrorCode
 * VALIDATION_ERROR) on out-of-range input so callers can map it 1:1 to the
 * error envelope.
 */
export function resolveTargetPages(targetPage: TargetPage, pageCount: number): number[] {
  if (pageCount <= 0) {
    throw new ValidationError("Cannot resolve a target page in a document with zero pages");
  }

  if (targetPage === "all") return Array.from({ length: pageCount }, (_, i) => i);
  if (targetPage === "first") return [0];
  if (targetPage === "last") return [pageCount - 1];

  if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > pageCount) {
    throw new ValidationError(
      `targetPage ${targetPage} is out of range for a ${pageCount}-page document (expected 1..${pageCount})`,
    );
  }

  return [targetPage - 1];
}

/**
 * The *first* page `targetPage` resolves to — i.e. `resolveTargetPages()[0]`.
 * For `"all"` that is page 0; callers that need the whole set (the injection
 * dispatcher, the API's job row) must use `resolveTargetPages` instead.
 */
export function resolveTargetPage(targetPage: TargetPage, pageCount: number): number {
  return resolveTargetPages(targetPage, pageCount)[0] as number;
}
