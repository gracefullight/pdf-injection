import type { SubmissionStatistics } from "@pdf-injection/contracts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function pValue(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

export interface SubmissionStatisticsCardProps {
  statistics: SubmissionStatistics;
  /**
   * Signal type names by index (e.g. from any loaded submission's own `analysis.signals`, which
   * share the same job-level `expectedSignals` order as `perSignal`) — falls back to the bare
   * `#N` index when unavailable. Fixes r11 review M-13b (rows were unlabeled `#0`, `#1`… while
   * every other screen names signals by type).
   */
  signalNames?: string[];
}

/**
 * Candidate vs baseline per-signal + combined rates with Fisher exact /
 * Holm-adjusted significance — non-overclaiming: this reports a statistical
 * association, never a definitive "cheating" verdict (PRD §20 #4, #10).
 */
export function SubmissionStatisticsCard({
  statistics,
  signalNames = [],
}: SubmissionStatisticsCardProps) {
  const insufficientData = statistics.candidateCount === 0 || statistics.baselineCount < 3;

  return (
    <Card data-testid="submission-statistics-card">
      <CardHeader>
        <CardTitle>Statistics</CardTitle>
        <p className="text-xs text-muted-foreground">
          {statistics.candidateCount} candidate · {statistics.baselineCount} baseline · family-wise
          α = {statistics.familyWiseAlpha}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {insufficientData && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="submission-statistics-empty-state"
          >
            Add at least 3 baseline texts (and at least 1 candidate) to calibrate a false-positive
            rate and compute significance.
          </p>
        )}

        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Per-signal rates
          </h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Signal</TableHead>
                <TableHead>Candidate rate</TableHead>
                <TableHead>Baseline rate</TableHead>
                <TableHead>Fisher exact p</TableHead>
                <TableHead>Holm-adjusted p</TableHead>
                <TableHead>Significant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statistics.perSignal.map((row) => (
                <TableRow key={row.index} data-testid={`submission-statistics-signal-${row.index}`}>
                  <TableCell>{signalNames[row.index] ?? `#${row.index}`}</TableCell>
                  <TableCell>{pct(row.candidateRate)}</TableCell>
                  <TableCell>{pct(row.baselineRate)}</TableCell>
                  <TableCell>{pValue(row.fisherExactP)}</TableCell>
                  <TableCell>{pValue(row.holmAdjustedP)}</TableCell>
                  <TableCell>
                    {row.significant === null ? (
                      "—"
                    ) : (
                      <Badge variant={row.significant ? "warning" : "secondary"}>
                        {row.significant ? "Yes" : "No"}
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Combined (all signals matched)
          </h4>
          <dl
            className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4"
            data-testid="submission-statistics-combined"
          >
            <div>
              <dt className="text-xs text-muted-foreground">Candidate rate</dt>
              <dd>{pct(statistics.combined.candidateAllRate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Baseline rate</dt>
              <dd>{pct(statistics.combined.baselineAllRate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Δ (percentage points)</dt>
              <dd>
                {statistics.combined.deltaPp === null
                  ? "—"
                  : `${statistics.combined.deltaPp.toFixed(1)} pp`}
              </dd>
            </div>
            <div>
              <dt
                className="text-xs text-muted-foreground"
                title="Fisher exact p (distinct from the Analysis card's empirical baseline p)"
              >
                Fisher exact p
              </dt>
              <dd>{pValue(statistics.combined.fisherExactP)}</dd>
            </div>
          </dl>
        </div>

        {statistics.notes.length > 0 && (
          <ul
            className="list-disc pl-5 text-xs text-muted-foreground"
            data-testid="submission-statistics-notes"
          >
            {statistics.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
