import type { PrivateManifest } from "@pdf-injection/contracts";
import { ApiError } from "../errors";

/**
 * Expected signals are optional when a job is generated (`POST /jobs` accepts
 * an empty list), but every feature that scores text against them needs at
 * least one — and since they are frozen into the job's private manifest at
 * generation time, a job created without any can never be scored. The scoring
 * endpoints call this up front so the caller gets one clear 422 instead of a
 * run that silently reports 0/0 signal matches.
 */
export const NO_EXPECTED_SIGNALS_MESSAGE =
  "This job has no expected signals, so its results cannot be scored. Expected signals are frozen " +
  "into a job when it is generated — regenerate the PDF with at least one expected signal to use " +
  "this feature.";

export function assertJobHasExpectedSignals(
  manifest: Pick<PrivateManifest, "expectedSignals">,
): void {
  if (manifest.expectedSignals.length === 0) {
    throw new ApiError("VALIDATION_ERROR", NO_EXPECTED_SIGNALS_MESSAGE);
  }
}
