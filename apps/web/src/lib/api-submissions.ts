import type {
  SubmissionAnalysis,
  SubmissionLabel,
  SubmissionListResponse,
  SubmissionStatistics,
} from "@pdf-injection/contracts";
import { API_PREFIX, authHeaders, eden, readErrorPayload, unwrapEdenAs } from "@/lib/eden-client";
import { ResearchApiError, toFormData } from "@/lib/research-fetch";

/**
 * `apps/api/src/routes/submissions.ts` is now registered on the Elysia `App` type
 * (`eden-client.ts`), so the plain-JSON endpoints (list/statistics/get/delete) go through Eden
 * Treaty, unwrapped into the same `ResearchApiError` class `research-fetch.ts`'s `fetchJson`
 * already throws — `instanceof ResearchApiError` checks in `submissions-tab.tsx` /
 * `submission-form.tsx` keep working unchanged.
 *
 * `createSubmission` stays on typed `fetch`: the request body is always `multipart/form-data`
 * (text-only submissions still go through `FormData`, not JSON — `apps/api`'s route parses
 * `request.formData()` directly, no Elysia body schema), matching the same category of route
 * `lib/api.ts`'s module doc documents (Eden Treaty's multipart auto-detection expects a plain
 * fields object it builds the `FormData` from itself, not a pre-built `FormData` instance, so
 * raw `fetch` is the simpler and more direct fit here).
 */
function unwrap<T>(result: { data: unknown; error: unknown; status: number }): T {
  return unwrapEdenAs<T, ResearchApiError>(result, ResearchApiError);
}

function submissionsUrl(jobId: string): string {
  return `${API_PREFIX}/jobs/${jobId}/submissions`;
}

export interface CreateSubmissionInput {
  jobId: string;
  accessToken: string;
  label: SubmissionLabel;
  /** Exactly one of `text` / `file` is expected (contract §3). */
  text?: string;
  file?: File;
}

export async function createSubmission(input: CreateSubmissionInput): Promise<SubmissionAnalysis> {
  const formData = toFormData({
    label: input.label,
    acknowledgeNoRealStudentData: "true",
    text: input.text,
    file: input.file,
  });
  const response = await fetch(submissionsUrl(input.jobId), {
    method: "POST",
    headers: authHeaders(input.accessToken),
    body: formData,
  });
  if (!response.ok) {
    throw new ResearchApiError(response.status, await readErrorPayload(response));
  }
  return (await response.json()) as SubmissionAnalysis;
}

export async function listSubmissions(
  jobId: string,
  accessToken: string,
): Promise<SubmissionListResponse> {
  const result = await eden.api.v1.jobs({ jobId }).submissions.get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<SubmissionListResponse>(result);
}

export async function getSubmissionStatistics(
  jobId: string,
  accessToken: string,
): Promise<SubmissionStatistics> {
  const result = await eden.api.v1.jobs({ jobId }).submissions.statistics.get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<SubmissionStatistics>(result);
}

export async function getSubmission(
  jobId: string,
  accessToken: string,
  submissionId: string,
): Promise<SubmissionAnalysis> {
  const result = await eden.api.v1
    .jobs({ jobId })
    .submissions({ submissionId })
    .get({
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  return unwrap<SubmissionAnalysis>(result);
}

export async function deleteSubmission(
  jobId: string,
  accessToken: string,
  submissionId: string,
): Promise<void> {
  const result = await eden.api.v1
    .jobs({ jobId })
    .submissions({ submissionId })
    .delete(undefined, {
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  if (result.status !== 204) {
    unwrap(result);
  }
}
