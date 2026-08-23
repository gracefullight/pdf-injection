import { ERROR_MESSAGES, type ModelTestRequest } from "@pdf-injection/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { NoExpectedSignalsNotice } from "@/components/no-expected-signals-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { shouldPollRun } from "@/features/model-test/model-test-helpers";
import { ModelTestResults } from "@/features/model-test/model-test-results";
import { ModelTestRunForm } from "@/features/model-test/model-test-run-form";
import { ModelTestRunsList } from "@/features/model-test/model-test-runs-list";
import { OpenAiDirectTestPanel } from "@/features/model-test/openai-direct-test-panel";
import { triggerBrowserDownload } from "@/lib/api";
import {
  createModelTestRun,
  deleteModelTestRun,
  exportModelTestRun,
  getModelTestRun,
  listModelTestRuns,
  ModelTestsApiError,
} from "@/lib/api-model-tests";
import { useFeatures } from "@/lib/features";

export interface ModelTestTabProps {
  jobId: string;
  accessToken: string;
  /** `false` → the job was generated without expected signals and cannot be scored; `undefined` while loading. */
  hasExpectedSignals?: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof ModelTestsApiError) {
    const known = ERROR_MESSAGES[error.code as keyof typeof ERROR_MESSAGES];
    return known ? known.en : error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error while contacting the server.";
}

/** Screen 4 "Model Test" tab — Phase 3 provider benchmark (real implementation, replaces the Phase 2 placeholder). */
export function ModelTestTab({ jobId, accessToken, hasExpectedSignals }: ModelTestTabProps) {
  const { features } = useFeatures();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ["job", jobId, "model-tests"],
    queryFn: () => listModelTestRuns(jobId, accessToken),
  });

  const runQuery = useQuery({
    queryKey: ["job", jobId, "model-tests", selectedRunId],
    queryFn: () => getModelTestRun(jobId, accessToken, selectedRunId as string),
    enabled: selectedRunId !== null,
    refetchInterval: (query) => (shouldPollRun(query.state.data?.status) ? 2000 : false),
  });

  // The runs list otherwise only refreshes on create/delete, so it kept showing a stale
  // "running · Cancel" row after the selected run's own polling already reported "completed"
  // just below it — two contradictory statuses on screen simultaneously (r11 review H-05).
  const lastNotifiedStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = runQuery.data?.status ?? null;
    if (status && !shouldPollRun(status) && lastNotifiedStatusRef.current !== status) {
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "model-tests"], exact: true });
    }
    lastNotifiedStatusRef.current = status;
  }, [runQuery.data?.status, jobId, queryClient]);

  const createRun = useMutation({
    mutationFn: (request: ModelTestRequest) => createModelTestRun(jobId, accessToken, request),
    onSuccess: (response) => {
      setRunError(null);
      setSelectedRunId(response.runId);
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "model-tests"] });
    },
    onError: (error) => setRunError(errorMessage(error)),
  });

  async function handleDelete(runId: string) {
    setDeletingRunId(runId);
    try {
      await deleteModelTestRun(jobId, accessToken, runId);
      if (selectedRunId === runId) setSelectedRunId(null);
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "model-tests"] });
    } finally {
      setDeletingRunId(null);
    }
  }

  async function handleExport(format: "json" | "csv") {
    if (!selectedRunId) return;
    setExporting(format);
    try {
      const file = await exportModelTestRun(jobId, accessToken, selectedRunId, format);
      triggerBrowserDownload(file);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="model-test-tab">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Model test</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs the injected PDF (and the untouched original) through one or more providers with the
          same outer prompt, and compares expected-signal rates. The "mock" provider is always
          available and never leaves this machine; other providers require this server to allow
          external transfer and have a configured API key.
        </p>
      </div>

      <OpenAiDirectTestPanel jobId={jobId} accessToken={accessToken} />

      {hasExpectedSignals === false ? (
        <NoExpectedSignalsNotice scores="model answers" />
      ) : (
        <ModelTestRunForm
          features={features}
          onRun={(request) => createRun.mutate(request)}
          submitting={createRun.isPending}
          error={runError}
        />
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-foreground">Runs</h4>
        <ModelTestRunsList
          runs={runsQuery.data?.runs ?? []}
          selectedRunId={selectedRunId}
          onSelect={setSelectedRunId}
          onDelete={handleDelete}
          deletingRunId={deletingRunId}
        />
      </div>

      {runQuery.data && (
        <ModelTestResults run={runQuery.data} onExport={handleExport} exporting={exporting} />
      )}

      {runQuery.isError && (
        <Alert variant="destructive" data-testid="model-test-run-load-error">
          <AlertTitle>Could not load this run</AlertTitle>
          <AlertDescription>{errorMessage(runQuery.error)}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
