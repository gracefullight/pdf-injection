import type { LintIssue } from "@pdf-injection/contracts";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/**
 * These errors are owned by their fields rather than the top-level lint panel. Empty form
 * requirements use neutral helper text, while an added-but-empty signal gets an inline error on
 * its card. They still fully gate `canContinue` upstream because only this display list is
 * filtered; lint's unfiltered `errors` array is untouched.
 */
const FIELD_ERROR_IDS = new Set(["empty_prompt", "empty_signal_value"]);

/** Short rule names instead of the generic "Warning" title on every alert — with 3-4 warnings
 * stacked (variants mode especially), the rule id was only visible in the testid, not to a
 * reading user (r11 review L-02). Falls back to "Warning" for any id not in this table. */
const WARNING_TITLES: Record<string, string> = {
  fake_citation: "Fake citation",
  fabricated_facts: "Fabricated facts",
  disclose_instruction: "Disclose instruction",
  jailbreak_phrasing: "Jailbreak phrasing",
  grading_distortion: "Grading distortion",
  exact_phrase_too_long: "Signal unusually long",
  common_signal: "Common word signal",
  inappropriate_methodology_hint: "Inappropriate methodology",
  no_expected_signals: "No expected signals",
};

export interface LintPanelProps {
  errors: LintIssue[];
  warnings: LintIssue[];
  acknowledged: string[];
  onAcknowledgedChange: (acknowledged: string[]) => void;
  /**
   * When provided, an `encoding_unsupported` error gets an inline action button next to the
   * message itself instead of relying on the professor to notice the payload-language hint
   * ~900px lower next to the settings form (r11 review M-21).
   */
  onSwitchToKorean?: () => void;
}

/** Live prompt-lint result. Errors block Generate; warnings require an explicit acknowledgement checkbox. */
export function LintPanel({
  errors,
  warnings,
  acknowledged,
  onAcknowledgedChange,
  onSwitchToKorean,
}: LintPanelProps) {
  const visibleErrors = errors.filter((issue) => !FIELD_ERROR_IDS.has(issue.id));
  if (visibleErrors.length === 0 && warnings.length === 0) return null;

  function toggle(id: string, checked: boolean) {
    onAcknowledgedChange(
      checked ? [...acknowledged, id] : acknowledged.filter((existing) => existing !== id),
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="lint-panel">
      {visibleErrors.map((issue) => (
        <Alert key={issue.id} variant="destructive" data-testid={`lint-error-${issue.id}`}>
          <CircleAlert />
          <AlertTitle>Fix required</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{issue.message}</span>
            {issue.id === "encoding_unsupported" && onSwitchToKorean && (
              <span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSwitchToKorean}
                  data-testid="lint-switch-to-korean-button"
                >
                  Switch payload language to Korean
                </Button>
              </span>
            )}
          </AlertDescription>
        </Alert>
      ))}

      {warnings.map((issue) => (
        <Alert key={issue.id} variant="warning" data-testid={`lint-warning-${issue.id}`}>
          <AlertTriangle />
          <AlertTitle>{WARNING_TITLES[issue.id] ?? "Warning"}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{issue.message}</span>
            <span className="flex items-center gap-2">
              <Checkbox
                id={`ack-${issue.id}`}
                checked={acknowledged.includes(issue.id)}
                onCheckedChange={(checked) => toggle(issue.id, checked === true)}
                data-testid={`lint-warning-ack-${issue.id}`}
              />
              <Label htmlFor={`ack-${issue.id}`} className="font-normal">
                I acknowledge this warning and want to proceed anyway
              </Label>
            </span>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
