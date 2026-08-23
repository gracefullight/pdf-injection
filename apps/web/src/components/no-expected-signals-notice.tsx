import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface NoExpectedSignalsNoticeProps {
  /** What the blocked feature scores, e.g. "model answers" or "submissions". */
  scores: string;
}

/**
 * Shown in place of a scoring feature's run form when the job was generated
 * without expected signals. Signals are optional at generation time but are
 * frozen into the job's private manifest, so they cannot be added afterwards —
 * the only way forward is to regenerate the PDF with at least one signal.
 * Mirrors the server's 422 from `apps/api/src/lib/expected-signals.ts`.
 */
export function NoExpectedSignalsNotice({ scores }: NoExpectedSignalsNoticeProps) {
  return (
    <Alert data-testid="no-expected-signals-notice">
      <Info aria-hidden="true" />
      <AlertTitle>This job has no expected signals</AlertTitle>
      <AlertDescription>
        Expected signals are the phrases, labels or term orders that {scores} are scored against.
        This job was generated without any, and signals are frozen into a job when it is generated —
        go back to step 2, add at least one expected signal, and generate a new PDF to use this
        feature.
      </AlertDescription>
    </Alert>
  );
}
