import type { PayloadLanguage } from "@pdf-injection/contracts";
import { parseStudentIdList } from "@/features/variants/student-id-list";
import { lintStudentKeyedTemplate } from "@/features/variants/student-keyed-lint";
import {
  validateInstructionTemplate,
  validateKeyLength,
} from "@/features/variants/template-validation";
import type { StudentKeyedDraft } from "@/features/variants/variant-types";

/**
 * Gates "Continue to generate" for `distributionMode: "student_keyed"`: a
 * valid `{{KEY}}` template, a valid key length, at least one expected
 * signal, at least one parsed student id, no lint errors on the template
 * (checked with a placeholder key substituted in, matching what will
 * actually be injected), and no unacknowledged lint warnings — mirrors
 * `isVariantSetValid`'s warning gate (QA result-qa-r7 MEDIUM 3).
 *
 * `payloadLanguage` is threaded into `lintStudentKeyedTemplate` (cycle 3 —
 * see that function's doc comment).
 */
export function isStudentKeyedDraftValid(
  draft: StudentKeyedDraft,
  payloadLanguage: PayloadLanguage,
): boolean {
  const templateResult = validateInstructionTemplate(draft.instructionTemplate);
  if (!templateResult.valid) return false;
  if (validateKeyLength(draft.keyLength) !== null) return false;
  if (draft.expectedSignals.length === 0) return false;

  const { ids } = parseStudentIdList(draft.studentIdsRaw);
  if (ids.length === 0) return false;

  const lint = lintStudentKeyedTemplate(
    draft.instructionTemplate,
    draft.expectedSignals,
    payloadLanguage,
  );
  if (lint.errors.length > 0) return false;
  const unacknowledged = lint.warnings.filter(
    (warning) => !draft.acknowledgedWarnings.includes(warning.id),
  );
  return unacknowledged.length === 0;
}
