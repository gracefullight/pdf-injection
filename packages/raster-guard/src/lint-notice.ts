/**
 * Notice linting — the same gate the PDF-object injection modes go through,
 * plus the checks that only matter once the payload is painted into pixels.
 *
 * `lintPrompt()` from `packages/prompt-lint` is reused verbatim rather than
 * reimplemented: fabricated-citation, grading-distortion and jailbreak-phrasing
 * requests are unacceptable in a Raster Guard notice for exactly the reasons
 * they are unacceptable in a hidden text instruction, and one implementation
 * means one place to fix.
 */

import { type ExpectedSignal, LIMITS, type LintIssue } from "@pdf-injection/contracts";
import { lintPrompt } from "@pdf-injection/prompt-lint";

/**
 * Painted notices longer than this rarely find a content-free band on a page
 * that also has content on it, so the plan silently drops rungs. Warn before
 * that happens rather than after.
 */
export const NOTICE_SOFT_MAX_CHARS = 900;

/**
 * Above this, a response sentence is long enough that an assistant is more
 * likely to paraphrase it than to reproduce it, which weakens the exact-phrase
 * canary (the order-tolerant one still applies).
 *
 * It is deliberately far above `packages/prompt-lint`'s own long-phrase
 * threshold. That check assumes an expected signal is a short distinctive
 * marker an answer might happen to contain; here the phrase is a whole sentence
 * the notice explicitly asks for, so a hundred-odd characters is the normal
 * case rather than a mistake — see `lintNotice()`.
 */
export const RESPONSE_SOFT_MAX_CHARS = 220;

export interface LintNoticeResult {
  errors: LintIssue[];
  warnings: LintIssue[];
}

export interface LintNoticeOptions {
  /**
   * The sentence the notice asks the assistant to reply with, when one is set.
   *
   * Supplying it suppresses the generic "expected signal value is unusually
   * long" warning for that one phrase and substitutes the check above, which is
   * calibrated for a sentence rather than for a marker.
   */
  responseSentence?: string;
}

export function lintNotice(
  noticeText: string,
  signals: ExpectedSignal[] = [],
  options: LintNoticeOptions = {},
): LintNoticeResult {
  const base = lintPrompt(noticeText, signals, { maxLength: LIMITS.maxInstructionChars });
  const response = options.responseSentence?.trim() ?? "";
  const warnings = response
    ? suppressResponseLengthWarning(base.warnings, noticeText, signals, response)
    : [...base.warnings];

  if (response.length > RESPONSE_SOFT_MAX_CHARS) {
    warnings.push({
      id: "notice_response_long",
      severity: "warning",
      message: `The response sentence is ${response.length} characters. A sentence that long is more likely to be paraphrased than repeated word for word, which weakens the exact-phrase canary — the order-tolerant one still applies.`,
    });
  }

  if (noticeText.length > NOTICE_SOFT_MAX_CHARS) {
    warnings.push({
      id: "notice_long_for_raster",
      severity: "warning",
      message: `The notice is ${noticeText.length} characters. Above roughly ${NOTICE_SOFT_MAX_CHARS} it often will not fit any content-free band, and rungs get skipped page by page. Check the plan warnings after generating.`,
    });
  }

  if (!/\n/.test(noticeText.trim()) && noticeText.length > 200) {
    warnings.push({
      id: "notice_unbroken_line",
      severity: "warning",
      message:
        "The notice is one long unbroken line. Hard line breaks give the painter better control over the block shape than automatic wrapping does.",
    });
  }

  return { errors: base.errors, warnings };
}

/**
 * Drops the warnings that only exist because the response sentence is one of
 * the signals.
 *
 * Rather than hardcoding the shared linter's own threshold, this re-runs it
 * without that signal and keeps only the warnings that survive: anything the
 * second run still reports is about something else and must not be swallowed.
 * That way a threshold change in `packages/prompt-lint` cannot silently turn
 * this into a filter that hides real issues.
 */
function suppressResponseLengthWarning(
  warnings: LintIssue[],
  noticeText: string,
  signals: ExpectedSignal[],
  response: string,
): LintIssue[] {
  const withoutResponse = signals.filter(
    (signal) => !(signal.type === "exact_phrase" && signal.value.trim() === response),
  );
  if (withoutResponse.length === signals.length) return [...warnings];

  const baseline = lintPrompt(noticeText, withoutResponse, {
    maxLength: LIMITS.maxInstructionChars,
  });
  const survivingIds = new Set(baseline.warnings.map((issue) => issue.id));

  return warnings.filter(
    (issue) => issue.id !== "exact_phrase_too_long" || survivingIds.has(issue.id),
  );
}
