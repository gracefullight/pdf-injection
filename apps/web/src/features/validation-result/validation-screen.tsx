import type {
  ClientValidationInput,
  PrivateManifest,
  ValidationReport,
  ValidationWarning,
} from "@pdf-injection/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExtractedTextTab } from "@/features/extracted-text/extracted-text-tab";
import { ModelTestTab } from "@/features/model-test/model-test-tab";
import { usePdfDocument } from "@/features/pdf-preview/use-pdf-document";
import { RobustnessTab } from "@/features/robustness/robustness-tab";
import { SubmissionsTab } from "@/features/submissions/submissions-tab";
import { DeleteJobDialog } from "@/features/validation-result/delete-job-dialog";
import { HumanViewTab } from "@/features/validation-result/human-view-tab";
import { OverallBadge } from "@/features/validation-result/overall-badge";
import { PdfStructureTab } from "@/features/validation-result/pdf-structure-tab";
import { PrivateManifestTab } from "@/features/validation-result/private-manifest-tab";
import { useClientValidation } from "@/features/validation-result/use-client-validation";
import { VisualDiffTab } from "@/features/visual-diff/visual-diff-tab";
import {
  ApiRequestError,
  deleteJob,
  downloadOutputPdf,
  downloadPrivateManifest,
  downloadValidationReport,
  fetchOutputPdfBytes,
  fetchSourcePdfBytes,
  getJobStatus,
  getPrivateManifest,
  getValidationReport,
  postClientValidation,
  triggerBrowserDownload,
} from "@/lib/api";

export interface ValidationScreenProps {
  jobId: string;
  accessToken: string;
  sourceStem: string;
  onDeleted: () => void;
  onStartOver: () => void;
}

/**
 * Short, human reasons the Overall badge isn't a plain PASS — M-05 (r11 review): the badge alone
 * gave no indication of *which* warnings, anywhere on the screen.
 *
 * Cycle 3 residual: the badge can also read `PASS_WITH_WARNINGS` purely because of a
 * `serverValidation.warnings` entry (e.g. `BACKGROUND_NOT_WHITE`, `ACCESSIBILITY_HIDDEN_TEXT`)
 * with none of the other conditions below true — that case produced an empty `reasons` array, so
 * the explanation line never rendered even though the badge wasn't PASS. `serverWarnings` now
 * feeds its own (already human-readable) `.message` into the list.
 */
function summarizeOverallReasons(
  summary:
    | {
        pdfJsRenderPassed: boolean | null;
        pageGeometryPreserved: boolean;
        pageCountPreserved: boolean;
        hiddenTextExtracted: boolean;
        qpdfStatus: string;
      }
    | null
    | undefined,
  acknowledgedLintWarnings: string[],
  serverWarnings: ValidationWarning[],
): string[] {
  if (!summary) return [];
  const reasons: string[] = [];
  if (summary.pdfJsRenderPassed === null) reasons.push("client-side visual diff not yet computed");
  else if (summary.pdfJsRenderPassed === false) reasons.push("client-side PDF.js render failed");
  if (!summary.pageGeometryPreserved) reasons.push("page geometry changed");
  if (!summary.pageCountPreserved) reasons.push("page count changed");
  if (!summary.hiddenTextExtracted) reasons.push("hidden text not extracted server-side");
  if (summary.qpdfStatus === "warning" || summary.qpdfStatus === "failed")
    reasons.push(`qpdf ${summary.qpdfStatus}`);
  for (const warning of serverWarnings) reasons.push(warning.message);
  if (acknowledgedLintWarnings.length > 0)
    reasons.push(`lint warnings acknowledged: ${acknowledgedLintWarnings.join(", ")}`);
  return reasons;
}

export function ValidationScreen({
  jobId,
  accessToken,
  sourceStem,
  onDeleted,
  onStartOver,
}: ValidationScreenProps) {
  const queryClient = useQueryClient();
  const {
    compute,
    computing,
    error: clientValidationError,
    result: clientValidationResult,
  } = useClientValidation();
  const [downloading, setDownloading] = useState<"output" | "manifest" | "report" | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [startOverConfirmOpen, setStartOverConfirmOpen] = useState(false);
  const hasPostedRef = useRef(false);

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJobStatus(jobId, accessToken),
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 1000 : false),
  });

  const reportQuery = useQuery<ValidationReport>({
    queryKey: ["job", jobId, "report"],
    queryFn: () => getValidationReport(jobId, accessToken),
    enabled: jobQuery.data?.status === "completed" || jobQuery.data?.status === "failed",
  });

  const manifestQuery = useQuery<PrivateManifest>({
    queryKey: ["job", jobId, "manifest"],
    queryFn: () => getPrivateManifest(jobId, accessToken),
    enabled: jobQuery.data?.status === "completed",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const sourceBytesQuery = useQuery({
    queryKey: ["job", jobId, "source-bytes"],
    queryFn: () => fetchSourcePdfBytes(jobId, accessToken),
    enabled: jobQuery.data?.status === "completed",
    // Immutable once a job is completed — defense-in-depth alongside the `exact: true` fix below
    // so a stray broad `invalidateQueries(["job", jobId])` elsewhere in the tree can never
    // trigger a spurious refetch + PDF.js re-parse of bytes that will never change (r11 DX M1).
    staleTime: Number.POSITIVE_INFINITY,
  });

  const outputBytesQuery = useQuery({
    queryKey: ["job", jobId, "output-bytes"],
    queryFn: () => fetchOutputPdfBytes(jobId, accessToken),
    enabled: jobQuery.data?.status === "completed",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { document: sourceDocument } = usePdfDocument(sourceBytesQuery.data ?? null);
  const { document: outputDocument } = usePdfDocument(outputBytesQuery.data ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryNonce is a trigger-only dep (bumped by handleRetryClientValidation) to force a rerun, since a hasPostedRef change alone doesn't trigger a dependency-array re-run.
  useEffect(() => {
    const needsClientValidation = jobQuery.data?.summary?.pdfJsRenderPassed === null;
    if (
      !needsClientValidation ||
      hasPostedRef.current ||
      !sourceBytesQuery.data ||
      !outputBytesQuery.data ||
      !manifestQuery.data ||
      !jobQuery.data
    ) {
      return;
    }

    hasPostedRef.current = true;
    compute(
      sourceBytesQuery.data,
      outputBytesQuery.data,
      jobQuery.data.injectionMode,
      jobQuery.data.targetPage,
      manifestQuery.data.prompt.normalizedInstruction,
    ).then((computation) => {
      if (!computation) {
        hasPostedRef.current = false; // allow retry on failure
        return;
      }
      postClientValidation(jobId, accessToken, computation.input)
        .then(() => {
          // `exact: true` on both — TanStack Query's default prefix match on `["job", jobId]`
          // would otherwise invalidate every query nested under it (source-bytes/output-bytes/
          // manifest/report and every research-mode tab's own query), triggering duplicate
          // network requests and — since sourceBytesQuery/outputBytesQuery feed
          // usePdfDocument() — a spurious full PDF.js re-parse cycle on data that never changed
          // (r11 DX review M1, confirmed live: source/output GETs fired twice, validation-report
          // GET fired three times in one session from this single broad invalidate).
          queryClient.invalidateQueries({ queryKey: ["job", jobId], exact: true });
          queryClient.invalidateQueries({ queryKey: ["job", jobId, "report"], exact: true });
        })
        .catch(() => {
          hasPostedRef.current = false;
        });
    });
  }, [
    jobQuery.data,
    sourceBytesQuery.data,
    outputBytesQuery.data,
    manifestQuery.data,
    compute,
    jobId,
    accessToken,
    queryClient,
    retryNonce,
  ]);

  function handleRetryClientValidation() {
    // hasPostedRef is already false after any failure path inside the effect above (compute()
    // returning null, or postClientValidation() rejecting); bumping this nonce is what re-runs
    // the effect, since a ref change alone doesn't trigger a dependency-array re-run.
    setRetryNonce((n) => n + 1);
  }

  async function handleDownload(kind: "output" | "manifest" | "report") {
    setDownloading(kind);
    try {
      const file =
        kind === "output"
          ? await downloadOutputPdf(jobId, accessToken, sourceStem)
          : kind === "manifest"
            ? await downloadPrivateManifest(jobId, accessToken, sourceStem)
            : await downloadValidationReport(jobId, accessToken, sourceStem);
      triggerBrowserDownload(file);
    } finally {
      setDownloading(null);
    }
  }

  async function handleDelete() {
    await deleteJob(jobId, accessToken);
    onDeleted();
  }

  if (jobQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading job status…</p>;
  }

  if (jobQuery.isError) {
    const message =
      jobQuery.error instanceof ApiRequestError
        ? jobQuery.error.message
        : "Could not load this job.";
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load job</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }

  const job = jobQuery.data;
  if (!job) return null;

  const targetPageIndex = job.targetPage;
  const overallReasons = summarizeOverallReasons(
    job.summary,
    reportQuery.data?.lint.acknowledged ?? [],
    reportQuery.data?.serverValidation.warnings ?? [],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="validation-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">4. Validate</h2>
          <p className="mt-1 text-sm text-muted-foreground">{job.sourceFilename}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Overall:</span>
            <OverallBadge status={job.summary?.overall ?? null} />
          </div>
          {job.summary && job.summary.overall !== "PASS" && (
            <p
              className="max-w-xs text-right text-xs text-muted-foreground"
              data-testid="overall-explanation"
            >
              {overallReasons.length > 0
                ? `Warnings: ${overallReasons.join("; ")}`
                : "See the Validation tabs below for details."}
            </p>
          )}
        </div>
      </div>

      {job.status === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>Generation failed</AlertTitle>
          <AlertDescription>{job.errorCode}</AlertDescription>
        </Alert>
      )}

      {computing && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Rendering and comparing pages in your browser…
        </p>
      )}
      {clientValidationError && (
        <Alert variant="destructive">
          <AlertTitle>Client-side validation failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{clientValidationError}</span>
            <span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetryClientValidation}
                disabled={computing}
                data-testid="client-validation-retry-button"
              >
                {computing ? "Retrying…" : "Retry"}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="human-view">
        {/*
         * Two-tier tab bar (r11 review H-02): the flat 8-trigger `TabsList` wrapped to 2 rows at
         * 1024/1280 and 3 rows at 375 — the wrapped "Submissions" trigger looked like a separate,
         * orphaned control. Grouping into primary validation views + a labeled "Research" group
         * (rendered as its own `TabsList`, both under the same `Tabs.Root` so they share
         * selection state) keeps each row a single visual unit at every width. `aria-label` added
         * to both lists (previously null on the single list).
         */}
        <div className="flex flex-col gap-2">
          <TabsList aria-label="Validation views">
            <TabsTrigger value="human-view" data-testid="tab-human-view">
              Human View
            </TabsTrigger>
            <TabsTrigger value="visual-diff" data-testid="tab-visual-diff">
              Visual Diff
            </TabsTrigger>
            <TabsTrigger value="extracted-text" data-testid="tab-extracted-text">
              Extracted Text
            </TabsTrigger>
            <TabsTrigger value="pdf-structure" data-testid="tab-pdf-structure">
              PDF Structure
            </TabsTrigger>
            <TabsTrigger value="private-manifest" data-testid="tab-private-manifest">
              Private Manifest
            </TabsTrigger>
          </TabsList>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Research
            </span>
            <TabsList aria-label="Research views" className="mt-1">
              <TabsTrigger value="model-test" data-testid="tab-model-test">
                Model Test
              </TabsTrigger>
              <TabsTrigger value="robustness" data-testid="tab-robustness">
                Robustness
              </TabsTrigger>
              <TabsTrigger value="submissions" data-testid="tab-submissions">
                Submissions
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="human-view">
          <ErrorBoundary label="the Human View tab">
            <HumanViewTab
              sourceDocument={sourceDocument}
              outputDocument={outputDocument}
              pageCount={outputDocument?.numPages ?? 0}
              targetPageIndex={targetPageIndex}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="visual-diff">
          <ErrorBoundary label="the Visual Diff tab">
            <VisualDiffTab
              sourceDocument={sourceDocument}
              outputDocument={outputDocument}
              pageDiffs={clientValidationResult?.pageDiffs ?? []}
              overallChangedPixelRatio={job.summary?.changedPixelRatio ?? null}
              overallPassed={clientValidationResult?.input.visualDiff.passed ?? null}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="extracted-text">
          <ErrorBoundary label="the Extracted Text tab">
            <ExtractedTextTab
              pageTexts={clientValidationResult?.extractedPageTexts ?? []}
              matches={
                clientValidationResult?.input.extractedText.pages ??
                ([] as ClientValidationInput["extractedText"]["pages"])
              }
              targetPageIndex={targetPageIndex}
              normalizedInstruction={manifestQuery.data?.prompt.normalizedInstruction ?? ""}
              injectionMode={job.injectionMode}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="pdf-structure">
          <ErrorBoundary label="the PDF Structure tab">
            <PdfStructureTab report={reportQuery.data ?? null} />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="private-manifest">
          <ErrorBoundary label="the Private Manifest tab">
            <PrivateManifestTab
              manifest={manifestQuery.data ?? null}
              onDownload={() => handleDownload("manifest")}
              downloading={downloading === "manifest"}
            />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="model-test">
          <ErrorBoundary label="the Model Test tab">
            <ModelTestTab jobId={jobId} accessToken={accessToken} />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="robustness">
          <ErrorBoundary label="the Robustness tab">
            <RobustnessTab jobId={jobId} accessToken={accessToken} />
          </ErrorBoundary>
        </TabsContent>

        <TabsContent value="submissions">
          <ErrorBoundary label="the Submissions tab">
            <SubmissionsTab jobId={jobId} accessToken={accessToken} />
          </ErrorBoundary>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleDownload("output")}
            disabled={downloading === "output" || job.errorCode === "RENDER_FAILED"}
            data-testid="download-output-button"
          >
            {downloading === "output" ? "Downloading…" : "Download output PDF"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleDownload("report")}
            disabled={downloading === "report"}
            data-testid="download-report-button"
          >
            {downloading === "report" ? "Downloading…" : "Download validation report"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStartOverConfirmOpen(true)}
            data-testid="start-over-button"
          >
            Start over
          </Button>
          <DeleteJobDialog onConfirm={handleDelete} />
        </div>
      </div>

      <ConfirmDialog
        open={startOverConfirmOpen}
        title="Start over?"
        description="This clears this job from your browser. The job itself stays on the server (24-hour retention). Download the output PDF or validation report first if you need them, or delete the job instead if you're done with it. You will not be able to reopen it from this browser unless you saved the job id and access token."
        confirmLabel="Start over"
        onCancel={() => setStartOverConfirmOpen(false)}
        onConfirm={() => {
          setStartOverConfirmOpen(false);
          onStartOver();
        }}
        data-testid="start-over-confirm-dialog"
        confirmTestId="start-over-confirm-button"
      />
    </div>
  );
}
