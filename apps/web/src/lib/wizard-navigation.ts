/** The four authoring-wizard steps, in order (see `App.tsx`). */
export type WizardStep = 1 | 2 | 3 | 4;

/**
 * Whether the stepper may jump from `currentStep` back to `target`.
 *
 * Two rules, both deliberate:
 *  - **Backwards only.** Step 4 (the result) is reached by generating a job,
 *    never by clicking ahead to a stale one, so forward jumps are refused.
 *  - **Source prerequisite.** Steps 2 (Instruction) and 3 (Generate) render
 *    nothing without the uploaded PDF, which is never persisted. After a
 *    refresh lands on step 4 with `hasSource` false, only step 1 (Upload) is a
 *    safe back target.
 */
export function canNavigateBackToStep(
  target: WizardStep,
  currentStep: WizardStep,
  hasSource: boolean,
): boolean {
  if (target >= currentStep) return false;
  if (target >= 2 && !hasSource) return false;
  return true;
}
