import { Laptop } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface LocalModeBannerProps {
  /** True when local mode was chosen because `GET /health` failed, rather than via `?local=1`. */
  becauseApiUnreachable: boolean;
}

/**
 * Tells the professor that nothing is leaving the browser — and, just as
 * importantly, which features that costs them. Shown on every screen while
 * local mode is active.
 */
export function LocalModeBanner({ becauseApiUnreachable }: LocalModeBannerProps) {
  return (
    <Alert data-testid="local-mode-banner">
      <Laptop aria-hidden="true" />
      <AlertTitle>On-device mode — your PDF never leaves this browser</AlertTitle>
      <AlertDescription>
        {becauseApiUnreachable
          ? "No API server is reachable, so injection and validation run entirely in this tab. "
          : "Injection and validation are running entirely in this tab. "}
        Every injection mode and payload language works — Korean/Chinese payloads download the
        bundled CJK font on first use. Model Test, Submissions and Robustness need a server and are
        unavailable, and the qpdf structural check does not run. Generated jobs are kept in memory
        only — download the PDF, private manifest and validation report before reloading.
      </AlertDescription>
    </Alert>
  );
}
