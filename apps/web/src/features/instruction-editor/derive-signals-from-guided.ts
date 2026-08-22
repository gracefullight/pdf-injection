import type { ExpectedSignal } from "@pdf-injection/contracts";
import type { GuidedInstructionFields } from "@/features/instruction-editor/guided-to-raw";

/**
 * Signal-equality for dedup purposes — two signals of the same type with the same
 * value(s)/pattern are the "same" expected signal regardless of incidental fields
 * (`caseSensitive`/`aliases`/`flags`), so deriving from the guided fields twice (or once after
 * the raw editor already produced an equivalent signal) never creates a duplicate row.
 */
function signalKey(signal: ExpectedSignal): string {
  switch (signal.type) {
    case "exact_phrase":
      return `exact_phrase:${signal.value.trim().toLowerCase()}`;
    case "regex":
      return `regex:${signal.pattern}`;
    case "methodology_label":
      return `methodology_label:${signal.value.trim().toLowerCase()}`;
    case "ordered_terms":
      return `ordered_terms:${signal.values.map((v) => v.trim().toLowerCase()).join("|")}`;
    case "section_order":
      return `section_order:${signal.values.map((v) => v.trim().toLowerCase()).join("|")}`;
  }
}

/**
 * Derives `ExpectedSignal`s from the Guided Editor's structured fields (r11 review L-03 —
 * previously the guided fields and the Expected-signal builder were entirely unlinked, so a
 * professor filling in "Preferred methodology: Method C" had to separately re-type "Method C"
 * into a Methodology label signal below). Pure and deterministic so it's unit-testable without
 * rendering anything.
 *
 * Only derives from fields that map cleanly onto an existing signal type:
 * - `preferredMethodology` -> `methodology_label`
 * - `orderedTerms` (2+ non-empty terms) -> `ordered_terms`
 * - `requiredSection` -> `section_order`
 *
 * `secondaryCondition` / `requiredLexicalSignal` / `notes` / `prohibitedDisclosure` don't map
 * onto a signal type 1:1 (they're prose conditions, not machine-checkable signals) and are left
 * out — `requiredLexicalSignal` is closest to `exact_phrase`, but the guided field's exact
 * wording ("Include the term X") is closer to a suggestion than a strict phrase match, so it's
 * deliberately not auto-added; the professor can still add it manually via Signal Builder.
 *
 * @param existingSignals Signals already in the Expected-signal list — any derived signal that
 * already exists (by `signalKey`) is skipped, so clicking "Add as expected signals" repeatedly
 * (or after the raw editor already produced an equivalent entry) never creates duplicates.
 * @returns Only the *new* signals to append — callers do `onChange([...existingSignals, ...derived])`.
 */
export function deriveSignalsFromGuided(
  fields: GuidedInstructionFields,
  existingSignals: ExpectedSignal[],
): ExpectedSignal[] {
  const derived: ExpectedSignal[] = [];

  const methodology = fields.preferredMethodology.trim();
  if (methodology.length > 0) {
    derived.push({ type: "methodology_label", value: methodology, aliases: [] });
  }

  const orderedTerms = fields.orderedTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  if (orderedTerms.length > 0) {
    derived.push({ type: "ordered_terms", values: orderedTerms });
  }

  const requiredSection = fields.requiredSection.trim();
  if (requiredSection.length > 0) {
    derived.push({ type: "section_order", values: [requiredSection] });
  }

  const existingKeys = new Set(existingSignals.map(signalKey));
  const seenDerivedKeys = new Set<string>();
  return derived.filter((signal) => {
    const key = signalKey(signal);
    if (existingKeys.has(key) || seenDerivedKeys.has(key)) return false;
    seenDerivedKeys.add(key);
    return true;
  });
}
