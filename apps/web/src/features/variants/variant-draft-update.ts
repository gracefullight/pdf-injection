import { pruneAcknowledgedWarnings } from "@/features/instruction-editor/prune-acknowledged-warnings";
import type { StudentKeyedDraft, VariantDraft } from "@/features/variants/variant-types";

/**
 * Applies `patch` to a `VariantDraft`, clearing that variant's own
 * `acknowledgedWarnings` whenever `instruction`/`signals` changes — mirrors
 * `App.tsx`'s `handleInstructionChange`/`handleSignalsChange` for the
 * single-mode flow (`pruneAcknowledgedWarnings(prev, [])`, an unconditional
 * reset): `LintIssue.id` is a fixed, content-independent string (e.g.
 * "jailbreak_phrasing"), so the same id re-triggering on materially
 * different text must not silently stay acknowledged. QA result-qa-r7
 * MEDIUM 2.
 */
export function updateVariantDraft(
  variant: VariantDraft,
  patch: Partial<VariantDraft>,
): VariantDraft {
  const next = { ...variant, ...patch };
  if (patch.instruction !== undefined || patch.signals !== undefined) {
    next.acknowledgedWarnings = pruneAcknowledgedWarnings(variant.acknowledgedWarnings, []);
  }
  return next;
}

/** Same reset rule as `updateVariantDraft`, for the student-keyed template + expected signals. */
export function updateStudentKeyedDraft(
  draft: StudentKeyedDraft,
  patch: Partial<StudentKeyedDraft>,
): StudentKeyedDraft {
  const next = { ...draft, ...patch };
  if (patch.instructionTemplate !== undefined || patch.expectedSignals !== undefined) {
    next.acknowledgedWarnings = pruneAcknowledgedWarnings(draft.acknowledgedWarnings, []);
  }
  return next;
}
