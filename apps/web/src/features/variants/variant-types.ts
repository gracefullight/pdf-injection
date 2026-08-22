import type { ExpectedSignal } from "@pdf-injection/contracts";

/** "single" = existing round-1 flow (POST /jobs); "variants"/"student_keyed" are round-2 (§1). */
export type DistributionMode = "single" | "variants" | "student_keyed";

export const MIN_VARIANTS = 2;
export const MAX_VARIANTS = 8;

export interface VariantDraft {
  label: string;
  instruction: string;
  signals: ExpectedSignal[];
  /** Per-variant lint-warning acknowledgement ids (mirrors the single-flow's `acknowledgedWarnings`, kept per card so two variants triggering the same lint id don't share one checkbox). */
  acknowledgedWarnings: string[];
}

export function defaultVariantDraft(label: string): VariantDraft {
  return { label, instruction: "", signals: [], acknowledgedWarnings: [] };
}

export function defaultVariantDrafts(): VariantDraft[] {
  return [defaultVariantDraft("A"), defaultVariantDraft("B")];
}

/** Picks the next unused A..Z letter, falling back to "V<n>" once the alphabet is exhausted. */
export function nextVariantLabel(existing: VariantDraft[]): string {
  const used = new Set(existing.map((variant) => variant.label));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return `V${existing.length + 1}`;
}

export interface StudentKeyedDraft {
  instructionTemplate: string;
  expectedSignals: ExpectedSignal[];
  studentIdsRaw: string;
  keyLength: number;
  /** Lint-warning acknowledgement ids for the template (see `lintStudentKeyedTemplate`), mirrors `VariantDraft.acknowledgedWarnings`. */
  acknowledgedWarnings: string[];
}

export const DEFAULT_KEY_LENGTH = 8;

export function defaultStudentKeyedDraft(): StudentKeyedDraft {
  return {
    instructionTemplate: "",
    expectedSignals: [],
    studentIdsRaw: "",
    keyLength: DEFAULT_KEY_LENGTH,
    acknowledgedWarnings: [],
  };
}
