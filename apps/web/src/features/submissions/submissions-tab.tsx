import type { SubmissionAnalysis } from "@pdf-injection/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { SubmissionAnalysisCard } from "@/features/submissions/submission-analysis-card";
import { SubmissionForm } from "@/features/submissions/submission-form";
import { SubmissionStatisticsCard } from "@/features/submissions/submission-statistics-card";
import { SubmissionsList } from "@/features/submissions/submissions-list";
import { deleteSubmission, getSubmissionStatistics, listSubmissions } from "@/lib/api-submissions";
import { FeatureGate, useFeatures } from "@/lib/features";
import { ResearchApiError } from "@/lib/research-fetch";

export interface SubmissionsTabProps {
  jobId: string;
  accessToken: string;
}

/**
 * Screen 4 "Submissions" tab (research mode, PS_RESEARCH_MODE) — Phase 4
 * submission detection research per phase3-5 contract §3 and PRD §20 (canary
 * match is never sole evidence; uncertainty + alternatives always shown).
 * Gated by r6's `FeatureGate`/`useFeatures()` (src/lib/features.tsx).
 */
export function SubmissionsTab({ jobId, accessToken }: SubmissionsTabProps) {
  const { features } = useFeatures();
  return (
    <FeatureGate feature="researchMode" features={features}>
      <SubmissionsTabContent jobId={jobId} accessToken={accessToken} />
    </FeatureGate>
  );
}

function SubmissionsTabContent({ jobId, accessToken }: SubmissionsTabProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Session-only cache of plain text submitted via "paste text" (see
  // SubmissionAnalysisCard's doc comment: the API never echoes raw text
  // back, so evidence highlighting only works for the text this browser
  // tab itself just submitted).
  const [textCache, setTextCache] = useState<Record<string, string>>({});

  const listQuery = useQuery({
    queryKey: ["job", jobId, "submissions"],
    queryFn: () => listSubmissions(jobId, accessToken),
  });

  const statisticsQuery = useQuery({
    queryKey: ["job", jobId, "submissions", "statistics"],
    queryFn: () => getSubmissionStatistics(jobId, accessToken),
  });

  const submissions = listQuery.data?.submissions ?? [];
  const selectedAnalysis = useMemo<SubmissionAnalysis | null>(
    () => submissions.find((s) => s.submissionId === selectedId) ?? null,
    [submissions, selectedId],
  );
  // Any submission's `signals` array shares the job-level `expectedSignals` order with
  // `SubmissionStatistics.perSignal` — used only to label statistics rows by name (M-13b).
  const signalNames = useMemo(
    () => submissions[0]?.signals.map((s) => s.signal.type) ?? [],
    [submissions],
  );

  function handleCreated(analysis: SubmissionAnalysis, submittedText: string | null) {
    if (submittedText !== null) {
      setTextCache((prev) => ({ ...prev, [analysis.submissionId]: submittedText }));
    }
    setSelectedId(analysis.submissionId);
    queryClient.invalidateQueries({ queryKey: ["job", jobId, "submissions"] });
    queryClient.invalidateQueries({ queryKey: ["job", jobId, "submissions", "statistics"] });
  }

  async function handleDelete(submissionId: string) {
    setDeletingId(submissionId);
    setDeleteError(null);
    try {
      await deleteSubmission(jobId, accessToken, submissionId);
      if (selectedId === submissionId) setSelectedId(null);
      setTextCache((prev) => {
        const next = { ...prev };
        delete next[submissionId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "submissions"] });
      queryClient.invalidateQueries({ queryKey: ["job", jobId, "submissions", "statistics"] });
    } catch (error) {
      setDeleteError(
        error instanceof ResearchApiError ? error.message : "Could not delete this submission.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="submissions-tab">
      <SubmissionForm jobId={jobId} accessToken={accessToken} onCreated={handleCreated} />

      <Separator />

      {listQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load submissions</AlertTitle>
          <AlertDescription>
            {listQuery.error instanceof ResearchApiError
              ? listQuery.error.message
              : "Unexpected error."}
          </AlertDescription>
        </Alert>
      )}

      {deleteError && (
        <Alert variant="destructive">
          <AlertTitle>Could not delete submission</AlertTitle>
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      )}

      <SubmissionsList
        submissions={submissions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onDelete={handleDelete}
        deletingId={deletingId}
      />

      {selectedAnalysis && (
        <SubmissionAnalysisCard
          analysis={selectedAnalysis}
          sourceText={textCache[selectedAnalysis.submissionId] ?? null}
        />
      )}

      {statisticsQuery.data && (
        <SubmissionStatisticsCard statistics={statisticsQuery.data} signalNames={signalNames} />
      )}
    </div>
  );
}
