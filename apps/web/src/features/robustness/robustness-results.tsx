import type { RobustnessRun } from "@pdf-injection/contracts";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  availabilityLabel,
  formatPercent,
  geometryLabel,
} from "@/features/robustness/robustness-helpers";

export interface RobustnessResultsProps {
  run: RobustnessRun;
  onDownloadArtifact: (transform: string) => void;
  downloadingTransform: string | null;
}

export function RobustnessResults({
  run,
  onDownloadArtifact,
  downloadingTransform,
}: RobustnessResultsProps) {
  const [expandedText, setExpandedText] = useState<Set<number>>(new Set());

  function toggleText(index: number) {
    setExpandedText((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="robustness-results">
      <div className="flex items-center gap-3" aria-live="polite">
        <span className="text-sm text-muted-foreground">
          Progress: {run.progress.done} / {run.progress.total}
        </span>
        <Progress
          value={run.progress.total > 0 ? (run.progress.done / run.progress.total) * 100 : 0}
          data-testid="robustness-progress-bar"
          className="max-w-64"
        />
        <Badge
          variant={run.status === "failed" ? "destructive" : "outline"}
          data-testid="robustness-run-status-badge"
        >
          {run.status}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="robustness-summary">
        {run.summary}
      </p>

      {run.pdfResults.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">PDF channel</h4>
          <Table data-testid="robustness-pdf-table">
            <TableHeader>
              <TableRow>
                <TableHead>Transform</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Hidden text extracted</TableHead>
                <TableHead>Target page match</TableHead>
                <TableHead>Geometry</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.pdfResults.map((result) => (
                <TableRow
                  key={result.transform}
                  data-testid={`robustness-pdf-row-${result.transform}`}
                >
                  <TableCell>{result.transform}</TableCell>
                  <TableCell>{availabilityLabel(result.available, result.reason)}</TableCell>
                  <TableCell>
                    {result.extraction
                      ? result.extraction.hiddenTextExtracted
                        ? "Yes"
                        : "No"
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {result.extraction ? (result.extraction.targetPageMatch ? "Yes" : "No") : "—"}
                  </TableCell>
                  <TableCell>{geometryLabel(result.geometryPreserved)}</TableCell>
                  <TableCell>
                    {result.available && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownloadArtifact(result.transform)}
                        disabled={downloadingTransform === result.transform}
                        data-testid={`robustness-pdf-download-${result.transform}`}
                      >
                        {downloadingTransform === result.transform ? "…" : "Download"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {run.textResults.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Text survival</h4>
          <Table data-testid="robustness-text-table">
            <TableHeader>
              <TableRow>
                <TableHead>Transform</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead>Survival rate</TableHead>
                <TableHead>Samples</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.textResults.map((result, index) => (
                <TableRow
                  key={`${result.transform}-${result.provider}`}
                  data-testid={`robustness-text-row-${result.transform}`}
                >
                  <TableCell>{result.transform}</TableCell>
                  <TableCell>{result.provider}</TableCell>
                  <TableCell>{availabilityLabel(result.available, result.reason)}</TableCell>
                  <TableCell>{formatPercent(result.survivalRate)}</TableCell>
                  <TableCell>
                    {result.samples.length > 0 ? (
                      <button
                        type="button"
                        className="cursor-pointer text-primary underline-offset-2 hover:underline"
                        onClick={() => toggleText(index)}
                        data-testid={`robustness-text-samples-toggle-${result.transform}`}
                      >
                        {expandedText.has(index) ? "Hide" : "Show"} {result.samples.length}{" "}
                        sample(s)
                      </button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {run.textResults.map((result, index) =>
            expandedText.has(index) ? (
              <ul
                key={`${result.transform}-${result.provider}-samples`}
                className="ml-4 list-disc text-xs text-muted-foreground"
                data-testid={`robustness-text-samples-${result.transform}`}
              >
                {result.samples.map((sample) => (
                  <li key={sample.inputSha256}>
                    Before: {sample.signalsBefore} signal{sample.signalsBefore === 1 ? "" : "s"}{" "}
                    matched
                    {sample.allMatchedBefore ? " (all)" : ""} → After: {sample.signalsAfter} signal
                    {sample.signalsAfter === 1 ? "" : "s"} matched
                    {sample.allMatchedAfter ? " (all)" : " (not all)"}
                  </li>
                ))}
              </ul>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
