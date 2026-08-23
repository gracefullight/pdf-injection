import type { InjectionMode } from "@pdf-injection/contracts";

/**
 * Round-3 research/diagnostic probe conditions (see
 * `.agents/state/memories/result-backend-probe-core.md`): channels that did **not**
 * reach the model (0/5 in the probe run) and are deterministically not extractable
 * by this app's own PDF.js-based extraction pipeline. They carry the "Experimental"
 * badge so they are never presented as working hiding techniques.
 *
 * `acroform_field` is deliberately NOT in this list even though it came from the
 * same probe round: it reached the model 5/5 (see `injection-anatomy.ts` — the one
 * invisible channel that did), so flagging it as experimental understated a result
 * this tool exists to surface. Its own caveat alert still explains that this app's
 * page-text extraction cannot show the payload.
 *
 * Shared between `features/instruction-editor` (mode picker) and `features/model-test`
 * (benchmark condition picker) — hoisted to `lib/` per the FSD-lite "no cross-feature
 * imports" rule rather than imported feature-to-feature.
 */
export const RESEARCH_PROBE_MODES: readonly InjectionMode[] = [
  "image_only",
  "freetext_annot",
  "info_dict",
];

export function isResearchProbeMode(mode: InjectionMode): boolean {
  return RESEARCH_PROBE_MODES.includes(mode);
}
