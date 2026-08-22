import type { ModelTestResult, ModelTestRun } from "@pdf-injection/contracts";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  deriveGateCardView,
  formatDeltaPp,
  formatLatency,
  formatPercent,
  sortAggregates,
} from "@/features/model-test/model-test-helpers";
import { formatDateTime } from "@/lib/format-date";

export interface ModelTestResultsProps {
  run: ModelTestRun;
  onExport: (format: "json" | "csv") => void;
  exporting: "json" | "csv" | null;
}

/** `ModelTestResult.ingestion` (contract addendum §6) — optional, so older result files lack it. */
const INGESTION_LABELS: Record<NonNullable<ModelTestResult["ingestion"]>, string> = {
  provider_native: "native PDF ingestion",
  text_extraction: "text extraction (Ollama)",
  mock: "mock ingestion",
};

function resultLabel(result: ModelTestResult): string {
  return `${result.provider}/${result.condition} #${result.repeat}`;
}

export function ModelTestResults({ run, onExport, exporting }: ModelTestResultsProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const gate = deriveGateCardView(run.smokeTestGate);
  const aggregates = sortAggregates(run.aggregates);
  // A gate card that says "passed" reads as a real result unless it's clear no real model was
  // called — the mock provider is a deterministic local simulation, not evidence about any real
  // LLM (r11 review M-15).
  const allMock =
    aggregates.length > 0 && aggregates.every((aggregate) => aggregate.provider === "mock");

  function toggle(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="model-test-results">
      <div className="flex items-center gap-3" aria-live="polite">
        <span className="text-sm text-muted-foreground">
          Progress: {run.progress.done} / {run.progress.total}
        </span>
        <Progress
          value={run.progress.total > 0 ? (run.progress.done / run.progress.total) * 100 : 0}
          data-testid="model-test-progress-bar"
          className="max-w-64"
        />
        <Badge
          variant={run.status === "failed" ? "destructive" : "outline"}
          data-testid="model-test-run-status-badge"
        >
          {run.status}
        </Badge>
      </div>

      <Card data-testid="model-test-gate-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {gate.headline}
            <Badge variant={gate.passed ? "success" : "warning"}>
              {gate.passed ? "passed" : "not met"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {allMock && (
            <p
              className="text-xs font-medium text-muted-foreground sm:col-span-2"
              data-testid="model-test-mock-only-note"
            >
              Simulation only: every provider in this run was "mock" (a deterministic local
              simulation). No real model was called.
            </p>
          )}
          <div>
            <span className="text-muted-foreground">Best condition: </span>
            {gate.bestLabel}
          </div>
          <div>
            <span className="text-muted-foreground">Positive-control compliance: </span>
            {gate.positiveControlLabel}
          </div>
          <div>
            <span className="text-muted-foreground">Original false-positive rate: </span>
            {gate.originalFpLabel}
          </div>
          <div>
            <span className="text-muted-foreground">Disclosure rate (injected): </span>
            {gate.disclosureLabel}
          </div>
          <div>
            <span className="text-muted-foreground">Variation across repeats: </span>
            {gate.variationLabel}
          </div>
          <p
            className="mt-2 text-sm text-muted-foreground sm:col-span-2"
            data-testid="model-test-interpretation"
          >
            {run.interpretation}
          </p>
        </CardContent>
      </Card>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Aggregates</h4>
        <Table data-testid="model-test-aggregates-table">
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>n</TableHead>
              <TableHead>All-signal rate</TableHead>
              <TableHead>Any-signal rate</TableHead>
              <TableHead>Δ vs original</TableHead>
              <TableHead>Disclosure rate</TableHead>
              <TableHead>Refusal rate</TableHead>
              <TableHead>Mean latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregates.map((aggregate) => (
              <TableRow
                key={`${aggregate.provider}-${aggregate.condition}`}
                data-testid={`model-test-aggregate-row-${aggregate.provider}-${aggregate.condition}`}
              >
                <TableCell>{aggregate.provider}</TableCell>
                <TableCell>{aggregate.condition}</TableCell>
                <TableCell>{aggregate.n}</TableCell>
                <TableCell>{formatPercent(aggregate.allSignalsRate)}</TableCell>
                <TableCell>{formatPercent(aggregate.anySignalRate)}</TableCell>
                <TableCell>{formatDeltaPp(aggregate.deltaVsOriginalPp)}</TableCell>
                <TableCell>{formatPercent(aggregate.disclosureRate)}</TableCell>
                <TableCell>{formatPercent(aggregate.refusalRate)}</TableCell>
                <TableCell>{formatLatency(aggregate.meanLatencyMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Per-call results</h4>
        <ul className="flex flex-col gap-2" data-testid="model-test-result-list">
          {run.results.map((result, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: results are append-only and never reordered within a run
              key={index}
              className="rounded-md border border-border p-2 text-sm"
              data-testid={`model-test-result-${index}`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => toggle(index)}
                data-testid={`model-test-result-toggle-${index}`}
                aria-expanded={expanded.has(index)}
              >
                <span className="flex items-center gap-1.5">
                  <ChevronRight
                    className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded.has(index) ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                  {resultLabel(result)}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={result.allSignalsMatched ? "success" : "outline"}>
                    {result.allSignalsMatched ? "all signals matched" : "not all matched"}
                  </Badge>
                  {result.disclosure && <Badge variant="warning">disclosure</Badge>}
                  {result.refusal && <Badge variant="secondary">refusal</Badge>}
                  {result.error && <Badge variant="destructive">error</Badge>}
                  {result.ingestion && (
                    <Badge variant="outline" data-testid={`model-test-result-ingestion-${index}`}>
                      {INGESTION_LABELS[result.ingestion]}
                    </Badge>
                  )}
                </span>
              </button>
              {expanded.has(index) && (
                <div
                  className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground"
                  data-testid={`model-test-result-detail-${index}`}
                >
                  <span>Latency: {formatLatency(result.latencyMs)}</span>
                  <span>
                    Tokens: in {result.usage.inputTokens ?? "—"} / out{" "}
                    {result.usage.outputTokens ?? "—"}
                  </span>
                  <span>Executed at: {formatDateTime(result.executedAt)}</span>
                  <details>
                    <summary className="cursor-pointer">
                      Raw response (collapsed by default)
                    </summary>
                    <pre
                      className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2"
                      data-testid={`model-test-raw-response-${index}`}
                    >
                      {result.rawResponse}
                    </pre>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onExport("json")}
          disabled={exporting !== null}
          data-testid="model-test-export-json-button"
        >
          {exporting === "json" ? "Exporting…" : "Export JSON"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onExport("csv")}
          disabled={exporting !== null}
          data-testid="model-test-export-csv-button"
        >
          {exporting === "csv" ? "Exporting…" : "Export CSV"}
        </Button>
      </div>
    </div>
  );
}
