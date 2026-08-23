/** Server-relative path the sample assignment PDF is served from (see `apps/web/public/samples/`). */
export const SAMPLE_PDF_URL = `${import.meta.env?.BASE_URL ?? "/"}samples/se-assignment-architecture-quality-plan.pdf`;
export const SAMPLE_PDF_FILENAME = "se-assignment-architecture-quality-plan.pdf";
export const SAMPLE_PDF_CHECKBOX_LABEL = "Use the sample assignment PDF";

/**
 * Which of the two alternative ways the currently-loaded source (if any) was set through —
 * `null` when nothing is loaded yet. Tracked separately from `UploadedSource` itself (which
 * doesn't know how it was produced) so the sample checkbox and a manual drop/pick can stay
 * mutually exclusive without a stuck "both" state.
 */
export type SourceOrigin = "manual" | "sample" | null;

export type SampleCheckboxAction =
  /** Uncheck while the sample is the active source: clear back to just the drop zone. */
  | { type: "clear" }
  /** Uncheck while the sample isn't the active source (e.g. a manual upload already replaced
   * it, or an in-flight fetch was cancelled before it landed) — nothing to undo. */
  | { type: "ignore" }
  /** Check: fetch the sample bytes and load them through the same path a manual upload uses. */
  | { type: "fetch" };

/**
 * Pure decision function for toggling the "Use the sample assignment PDF" checkbox, kept
 * side-effect-free (no `fetch`, no state setters) so the checked/unchecked <-> sample/manual
 * state-coherence rules are unit-testable without a DOM or network mock.
 */
export function decideSampleCheckboxAction(
  checked: boolean,
  currentOrigin: SourceOrigin,
): SampleCheckboxAction {
  if (checked) return { type: "fetch" };
  return currentOrigin === "sample" ? { type: "clear" } : { type: "ignore" };
}

/**
 * Turns fetched sample-PDF bytes into a `File`, matching what a manual file-picker/drop produces.
 * Takes the `ArrayBuffer`-backed `Uint8Array<ArrayBuffer>` form specifically (not the wider,
 * default `Uint8Array<ArrayBufferLike>`) — that's what `new Uint8Array(await res.arrayBuffer())`
 * actually produces, and it's what `BlobPart` (the `File`/`Blob` constructor's item type) requires
 * under this project's TypeScript/DOM lib version.
 */
export function buildSampleFile(bytes: Uint8Array<ArrayBuffer>): File {
  return new File([bytes], SAMPLE_PDF_FILENAME, { type: "application/pdf" });
}
