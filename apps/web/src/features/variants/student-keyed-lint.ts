import type { ExpectedSignal, LintIssue, PayloadLanguage } from "@pdf-injection/contracts";
import { lintPrompt } from "@pdf-injection/prompt-lint";
import { KEY_PLACEHOLDER } from "@/features/variants/template-validation";

const SAMPLE_KEY = "SAMPLEKEY01";

/**
 * Lints a student-keyed instruction template with `{{KEY}}` substituted by a
 * fixed sample key — matching what will actually be injected per-student —
 * so the template's `LintPanel` and `isStudentKeyedDraftValid` see identical
 * errors/warnings. Shared so the two call sites can't drift.
 *
 * `payloadLanguage` must be threaded through to `lintPrompt`'s
 * non-printable-ASCII check the same way `instruction-screen.tsx` does for
 * the single-mode flow — otherwise it always lints in "en" mode
 * (`opts.payloadLanguage` undefined !== "ko"), so a Korean template gets
 * flagged `encoding_unsupported` as a lint ERROR even after "ko" is selected
 * in `InjectionSettingsForm`, permanently blocking "Continue to generate"
 * for student-keyed sets in ko payload mode. Same bug class r9 fixed for
 * `instruction-screen.tsx`'s own `lintPrompt` call (cycle 3).
 */
export function lintStudentKeyedTemplate(
  instructionTemplate: string,
  expectedSignals: ExpectedSignal[],
  payloadLanguage: PayloadLanguage,
): { errors: LintIssue[]; warnings: LintIssue[] } {
  const sampleInstruction = instructionTemplate.replaceAll(KEY_PLACEHOLDER, SAMPLE_KEY);
  return lintPrompt(sampleInstruction, expectedSignals, { payloadLanguage });
}
