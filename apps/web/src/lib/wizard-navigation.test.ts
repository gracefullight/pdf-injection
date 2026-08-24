import { describe, expect, it } from "bun:test";
import { canNavigateBackToStep, type WizardStep } from "@/lib/wizard-navigation";

describe("canNavigateBackToStep", () => {
  it("lets the terminal result step go back to step 3 or step 2", () => {
    // The reason this feature exists: from step 4 the professor can return to
    // the Generate / Instruction steps to tweak and regenerate.
    expect(canNavigateBackToStep(3, 4, true)).toBe(true);
    expect(canNavigateBackToStep(2, 4, true)).toBe(true);
    expect(canNavigateBackToStep(1, 4, true)).toBe(true);
  });

  it("refuses the current step and any forward jump", () => {
    expect(canNavigateBackToStep(4, 4, true)).toBe(false);
    expect(canNavigateBackToStep(2, 2, true)).toBe(false);
    expect(canNavigateBackToStep(3, 2, true)).toBe(false);
    expect(canNavigateBackToStep(4, 3, true)).toBe(false);
  });

  it("without the source PDF, only Upload (step 1) is reachable", () => {
    // Steps 2/3 render nothing without the uploaded file (never persisted), so
    // a refresh that lands on step 4 may go back only to step 1.
    expect(canNavigateBackToStep(1, 4, false)).toBe(true);
    expect(canNavigateBackToStep(2, 4, false)).toBe(false);
    expect(canNavigateBackToStep(3, 4, false)).toBe(false);
  });

  it("going back one step from every position resolves correctly with a source", () => {
    const steps: WizardStep[] = [2, 3, 4];
    for (const step of steps) {
      expect(canNavigateBackToStep((step - 1) as WizardStep, step, true)).toBe(true);
    }
  });
});
