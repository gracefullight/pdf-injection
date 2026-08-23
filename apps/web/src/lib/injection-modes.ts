import type { InjectionMode } from "@pdf-injection/contracts";

/**
 * Round-3 research/diagnostic probe conditions (see
 * `.agents/state/memories/result-backend-probe-core.md`). Distinct from the five
 * production/positive-control channels — never presented as hiding techniques, and
 * deterministically not extractable by this app's own PDF.js-based extraction pipeline.
 *
 * Shared between `features/instruction-editor` (mode picker) and `features/model-test`
 * (benchmark condition picker) — hoisted to `lib/` per the FSD-lite "no cross-feature
 * imports" rule rather than imported feature-to-feature.
 */
export const RESEARCH_PROBE_MODES: readonly InjectionMode[] = [
  "image_only",
  "freetext_annot",
  "acroform_field",
  "info_dict",
];

export function isResearchProbeMode(mode: InjectionMode): boolean {
  return RESEARCH_PROBE_MODES.includes(mode);
}
