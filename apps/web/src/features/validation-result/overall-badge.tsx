import type { OverallStatus } from "@pdf-injection/contracts";
import { Badge } from "@/components/ui/badge";

// Only these four words are ever shown for the overall result — the PRD §17.5
// forbidden-phrase list (Safe / Undetectable / AI proof / Cheating proof /
// Guaranteed to work) never appears in this component.
const VARIANT_BY_STATUS: Record<
  OverallStatus,
  "success" | "warning" | "destructive" | "secondary"
> = {
  PASS: "success",
  PASS_WITH_WARNINGS: "warning",
  FAIL: "destructive",
  NOT_TESTED: "secondary",
};

export interface OverallBadgeProps {
  status: OverallStatus | null;
}

export function OverallBadge({ status }: OverallBadgeProps) {
  const resolved = status ?? "NOT_TESTED";
  return (
    <Badge variant={VARIANT_BY_STATUS[resolved]} role="status" data-testid="overall-badge">
      {resolved}
    </Badge>
  );
}
