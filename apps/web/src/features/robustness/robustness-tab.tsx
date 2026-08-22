import { ERROR_MESSAGES, type RobustnessRequest } from "@pdf-injection/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { shouldPollRun } from "@/features/robustness/robustness-helpers";
import { RobustnessResults } from "@/features/robustness/robustness-results";
import { RobustnessRunForm } from "@/features/robustness/robustness-run-form";
import { RobustnessRunsList } from "@/features/robustness/robustness-runs-list";
import { ScreenshotOcrPanel } from "@/features/robustness/screenshot-ocr-panel";
import { triggerBrowserDownload } from "@/lib/api";
import { listModelTestRuns } from "@/lib/api-model-tests";
import {
  createRobustnessRun,
  deleteRobustnessRun,
  downloadRobustnessArtifact,
  getRobustnessRun,
  listRobustnessRuns,
  RobustnessApiError,
  uploadRobustnessScreenshots,
} from "@/lib/api-robustness";
import { FeatureGate, useFeatures } from "@/lib/features";

export interface RobustnessTabProps {
  jobId: string;
  accessToken: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof RobustnessApiError) {
    const known = ERROR_MESSAGES[error.code as keyof typeof ERROR_MESSAGES];
    return known ? known.en : error.message;
  }
  return error instanceof Error ? error.message : "Unexpected error while contacting the server.";
}

/** Screen 4 "Robustness" tab — Phase 5 transformation experiments (research mode only). */
export function RobustnessTab({ jobId, accessToken }: RobustnessTabProps) {
  const { features } = useFeatures();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [downloadingTransform, setDownloadingTransform] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const modelTestRunsQuery = useQuery({
    queryKey: ["job", jobId, "model-tests"],
    queryFn: () => listModelTestRuns(jobId, accessToken),
    enabled: features.researchMode,
  });

  const runsQuery = useQuery({
    queryKey: ["job", jobId, "robustness"],
    queryFn: () => listRobustnessRuns(jobId, accessToken),
    enabled: features.researchMode,
  });

  const runQuery = useQuery({
    queryKey: ["job", jobId, "robustness", selectedRunId],
    queryFn: () => getRobustnessRun(jobId, accessToken, selectedRunId as string),
    enabled: features.researchMode && selectedRunId !== null,
    refetchInterval: (query) => (shouldPollRun(query.state.data?.status) ? 2000 : false),
  });

  // Same fix as model-test-tab.tsx's runsQuery invalidation — see that file's comment (r11 H-05).
  const lastNotifiedStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const status = runQuery.data?.status ?? null;
    if (status && !shouldPollRun(status) && lastNotifiedStatusRef.current !== status) {
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "robustness"], exact: true });
    }
    lastNotifiedStatusRef.current = status;
  }, [runQuery.data?.status, jobId, queryClient]);

  const createRun = useMutation({
    mutationFn: (request: RobustnessRequest) => createRobustnessRun(jobId, accessToken, request),
    onSuccess: (response) => {
      setRunError(null);
      setSelectedRunId(response.runId);
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "robustness"] });
    },
    onError: (error) => setRunError(errorMessage(error)),
  });

  async function handleDelete(runId: string) {
    setDeletingRunId(runId);
    try {
      await deleteRobustnessRun(jobId, accessToken, runId);
      if (selectedRunId === runId) setSelectedRunId(null);
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "robustness"] });
    } finally {
      setDeletingRunId(null);
    }
  }

  async function handleDownloadArtifact(transform: string) {
    if (!selectedRunId) return;
    setDownloadingTransform(transform);
    try {
      const file = await downloadRobustnessArtifact(jobId, accessToken, selectedRunId, transform);
      triggerBrowserDownload(file);
    } finally {
      setDownloadingTransform(null);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="robustness-tab">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Robustness</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tests whether the hidden instruction and expected signals survive common transformations
          (print-to-PDF, OCR regeneration, paraphrase, translation, human editing) or a student
          screenshot round-trip.
        </p>
      </div>

      <FeatureGate feature="researchMode" features={features}>
        <RobustnessRunForm
          features={features}
          modelTestRuns={modelTestRunsQuery.data?.runs ?? []}
          onRun={(request) => createRun.mutate(request)}
          submitting={createRun.isPending}
          error={runError}
        />

        <div>
          <h4 className="mb-2 text-sm font-semibold text-foreground">Runs</h4>
          <RobustnessRunsList
            runs={runsQuery.data?.runs ?? []}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
            onDelete={handleDelete}
            deletingRunId={deletingRunId}
          />
        </div>

        {runQuery.data && (
          <RobustnessResults
            run={runQuery.data}
            onDownloadArtifact={handleDownloadArtifact}
            downloadingTransform={downloadingTransform}
          />
        )}

        {runQuery.isError && (
          <Alert variant="destructive" data-testid="robustness-run-load-error">
            <AlertTitle>Could not load this run</AlertTitle>
            <AlertDescription>{errorMessage(runQuery.error)}</AlertDescription>
          </Alert>
        )}

        <ScreenshotOcrPanel
          features={features}
          onUpload={(files) => uploadRobustnessScreenshots(jobId, accessToken, files)}
        />
      </FeatureGate>
    </div>
  );
}
