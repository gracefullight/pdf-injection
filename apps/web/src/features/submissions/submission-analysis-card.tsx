import type {
  SubmissionAnalysis,
  SubmissionInterpretationHeadline,
} from "@pdf-injection/contracts";
import { Badge } from "@/components/ui/badge";
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
  computeHighlightSegments,
  extractEvidenceSpans,
} from "@/features/submissions/highlight-spans";

// "matched" is a neutral research finding, not a verdict — green ("success") reads as "good/
// caught", which overclaims (PRD §20 (10) non-verdict UI); kept neutral like "no consistent
// signal" (r11 review M-13a).
const HEADLINE_VARIANT: Record<SubmissionInterpretationHeadline, "secondary" | "warning"> = {
  "Hidden instruction signal matched": "secondary",
  "Behavioral canary detected": "warning",
  "No consistent signal": "secondary",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export interface SubmissionAnalysisCardProps {
  analysis: SubmissionAnalysis;
  /**
   * The submitted text, if known client-side (only for text-paste input in
   * the current browser session — the API never echoes raw text back, per
   * the privacy requirement that submission content isn't persisted for
   * display). Without it, evidence is still listed, just not highlighted
   * against the original text.
   */
  sourceText: string | null;
}

/** Signal + evidence + group/combined scores + calibration + interpretation for one submission. */
export function SubmissionAnalysisCard({ analysis, sourceText }: SubmissionAnalysisCardProps) {
  return (
    <Card data-testid={`submission-analysis-${analysis.submissionId}`}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Analysis</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {analysis.label} · {analysis.source} · {analysis.textLength.toLocaleString()} characters
          </p>
        </div>
        <Badge
          variant={HEADLINE_VARIANT[analysis.interpretation.headline]}
          data-testid="submission-headline"
        >
          {analysis.interpretation.headline}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="text-sm text-foreground" data-testid="submission-interpretation-text">
          {analysis.interpretation.text}
        </p>

        {analysis.interpretation.alternatives.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Alternative explanations
            </h4>
            <ul
              className="mt-1 list-disc pl-5 text-sm text-foreground"
              data-testid="submission-alternatives"
            >
              {analysis.interpretation.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </div>
        )}

        <p
          className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground"
          data-testid="submission-uncertainty"
        >
          {analysis.interpretation.uncertainty}
        </p>

        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Group + combined scores
          </h4>
          <div className="mt-2 flex flex-col gap-2">
            {(["methodology", "lexical", "structural", "combined"] as const).map((key) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs capitalize text-muted-foreground">
                  {key}
                </span>
                <Progress
                  value={analysis.scores[key] * 100}
                  className="flex-1"
                  data-testid={`submission-score-${key}`}
                />
                <span className="w-10 shrink-0 text-right text-xs text-foreground">
                  {pct(analysis.scores[key])}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Signals</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Matched</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.signals.map((signalMatch, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: server response has no stable per-signal id
                <TableRow key={index} data-testid={`submission-signal-row-${index}`}>
                  <TableCell className="capitalize">{signalMatch.group}</TableCell>
                  <TableCell>{signalMatch.signal.type}</TableCell>
                  <TableCell>
                    <Badge variant={signalMatch.matched ? "success" : "secondary"}>
                      {signalMatch.matched ? "Matched" : "No match"}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-pre-wrap text-xs">
                    {sourceText
                      ? computeHighlightSegments(
                          sourceText,
                          extractEvidenceSpans(signalMatch.evidence, sourceText.length),
                        ).map((segment, segmentIndex) =>
                          segment.highlighted ? (
                            <mark
                              // biome-ignore lint/suspicious/noArrayIndexKey: derived, order-stable text segments
                              key={segmentIndex}
                              className="rounded-sm bg-warning px-0.5 text-warning-foreground"
                            >
                              {segment.text}
                            </mark>
                          ) : (
                            // biome-ignore lint/suspicious/noArrayIndexKey: derived, order-stable text segments
                            <span key={segmentIndex}>{segment.text}</span>
                          ),
                        )
                      : signalMatch.matched
                        ? "Matched (original text not retained by the server for display)."
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Calibration</h4>
          <dl
            className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4"
            data-testid="submission-calibration"
          >
            <div>
              <dt className="text-xs text-muted-foreground">Baseline count</dt>
              <dd>{analysis.calibration.baselineCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Baseline FP rate</dt>
              <dd>
                {analysis.calibration.baselineFalsePositiveRate === null
                  ? "—"
                  : pct(analysis.calibration.baselineFalsePositiveRate)}
              </dd>
            </div>
            <div>
              <dt
                className="text-xs text-muted-foreground"
                title="Empirical baseline p-value (distinct from the Statistics card's Fisher exact p)"
              >
                Empirical baseline p
              </dt>
              <dd>
                {analysis.calibration.pValue === null
                  ? "—"
                  : analysis.calibration.pValue.toFixed(4)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Holm-adjusted p</dt>
              <dd>
                {analysis.calibration.holmAdjustedPValue === null
                  ? "—"
                  : analysis.calibration.holmAdjustedPValue.toFixed(4)}
              </dd>
            </div>
          </dl>
          {analysis.calibration.method === "insufficient_baseline" && (
            <p
              className="mt-2 text-xs text-muted-foreground"
              data-testid="submission-calibration-insufficient"
            >
              Add at least 3 baseline submissions to calibrate a false-positive rate for this job.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
