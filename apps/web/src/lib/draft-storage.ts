import type { ExpectedSignal } from "@pdf-injection/contracts";
import type { InjectionSettings } from "@/features/instruction-editor/instruction-types";
import type {
  DistributionMode,
  StudentKeyedDraft,
  VariantDraft,
} from "@/features/variants/variant-types";

/**
 * sessionStorage-backed draft persistence for the Instruction screen (r11 review M-18) — mirrors
 * `job-storage.ts` / `set-storage.ts`'s pattern. Persists only the in-progress *authoring* state
 * (instruction text, signals, injection settings, distribution-mode drafts) — never the uploaded
 * PDF bytes (too large for sessionStorage, and re-selecting the file is a cheap ask) and never
 * any credential/token (those already have their own storage modules). A page reload mid-Instruction
 * previously dropped straight back to an empty Upload screen with everything lost.
 */
const DRAFT_KEY = "pdf-injection.draft.v1";
const SCHEMA_VERSION = 1 as const;

export interface InstructionDraft {
  instruction: string;
  signals: ExpectedSignal[];
  settings: InjectionSettings;
  distributionMode: DistributionMode;
  variantDrafts: VariantDraft[];
  studentKeyedDraft: StudentKeyedDraft;
}

interface StoredDraftEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  draft: InstructionDraft;
}

/** Pure — testable without sessionStorage. */
export function serializeDraft(draft: InstructionDraft): string {
  const envelope: StoredDraftEnvelope = { schemaVersion: SCHEMA_VERSION, draft };
  return JSON.stringify(envelope);
}

/**
 * Pure — testable without sessionStorage. Returns `null` for anything that isn't a
 * recognizably-shaped, current-schema-version draft (missing sessionStorage entry, malformed
 * JSON, a foreign/older schema, or a shape that doesn't match `InstructionDraft`) rather than
 * throwing — a corrupted or stale entry must never block the wizard from loading.
 */
export function deserializeDraft(raw: string | null): InstructionDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as Partial<StoredDraftEnvelope>;
  if (
    envelope.schemaVersion !== SCHEMA_VERSION ||
    !envelope.draft ||
    typeof envelope.draft !== "object"
  ) {
    return null;
  }
  const draft = envelope.draft as Partial<InstructionDraft>;
  if (
    typeof draft.instruction !== "string" ||
    !Array.isArray(draft.signals) ||
    !draft.settings ||
    typeof draft.settings !== "object" ||
    typeof draft.distributionMode !== "string" ||
    !Array.isArray(draft.variantDrafts) ||
    !draft.studentKeyedDraft ||
    typeof draft.studentKeyedDraft !== "object"
  ) {
    return null;
  }
  return draft as InstructionDraft;
}

/** An all-defaults draft is noise, not something worth restoring on a future visit. */
export function isDraftMeaningful(draft: InstructionDraft): boolean {
  return (
    draft.instruction.trim().length > 0 ||
    draft.signals.length > 0 ||
    draft.distributionMode !== "single" ||
    draft.variantDrafts.some(
      (variant) => variant.instruction.trim().length > 0 || variant.signals.length > 0,
    ) ||
    draft.studentKeyedDraft.instructionTemplate.trim().length > 0 ||
    draft.studentKeyedDraft.expectedSignals.length > 0
  );
}

/** No-ops (clears any stored draft) when the draft has nothing worth keeping. */
export function saveDraft(draft: InstructionDraft): void {
  if (!isDraftMeaningful(draft)) {
    clearDraft();
    return;
  }
  sessionStorage.setItem(DRAFT_KEY, serializeDraft(draft));
}

export function loadDraft(): InstructionDraft | null {
  return deserializeDraft(sessionStorage.getItem(DRAFT_KEY));
}

export function clearDraft(): void {
  sessionStorage.removeItem(DRAFT_KEY);
}
