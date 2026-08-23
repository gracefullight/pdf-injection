import type { PayloadLanguage } from "@pdf-injection/contracts";
import { lintPrompt } from "@pdf-injection/prompt-lint";
import { MAX_VARIANTS, MIN_VARIANTS, type VariantDraft } from "@/features/variants/variant-types";

/**
 * Gates "Continue to generate" for `distributionMode: "variants"`: count in
 * [MIN_VARIANTS, MAX_VARIANTS], unique non-empty labels, every variant has a
 * non-empty instruction, no lint errors, and no unacknowledged lint warnings
 * (expected signals are optional).
 *
 * `payloadLanguage` is threaded into `lintPrompt` — otherwise a Korean
 * variant instruction is always flagged `encoding_unsupported` even after
 * "ko" is selected in `InjectionSettingsForm` (cycle 3, same bug class r9
 * fixed for `instruction-screen.tsx`'s single-mode `lintPrompt` call).
 */
export function isVariantSetValid(
  variants: VariantDraft[],
  payloadLanguage: PayloadLanguage,
): boolean {
  if (variants.length < MIN_VARIANTS || variants.length > MAX_VARIANTS) return false;

  const labels = variants.map((variant) => variant.label.trim());
  if (labels.some((label) => label.length === 0)) return false;
  if (new Set(labels).size !== labels.length) return false;

  return variants.every((variant) => {
    if (variant.instruction.trim().length === 0) return false;
    const lint = lintPrompt(variant.instruction, variant.signals, { payloadLanguage });
    if (lint.errors.length > 0) return false;
    const unacknowledged = lint.warnings.filter(
      (warning) => !variant.acknowledgedWarnings.includes(warning.id),
    );
    return unacknowledged.length === 0;
  });
}
