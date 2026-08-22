import type {
  ApiError,
  PdfTransform,
  RobustnessRequest,
  RobustnessRun,
  RunStatus,
  ScreenshotOcrResult,
  TextTransform,
} from "@pdf-injection/contracts";
import { parseContentDispositionFilename } from "@/lib/content-disposition";
import { API_PREFIX, authHeaders, eden, readErrorPayload, unwrapEdenAs } from "@/lib/eden-client";

/**
 * Phase 5 (robustness) API client. `apps/api/src/routes/robustness.ts` is now registered on
 * the Elysia `App` type (see `api-model-tests.ts`'s module doc for the full explanation; same
 * situation here), so the JSON endpoints (create/list/get/delete) go through Eden Treaty,
 * matched against `.agents/results/api-contracts/pdf-injection-phase3-5-api.md` §4.
 *
 * `downloadRobustnessArtifact` (PDF, raw `Response`) and `uploadRobustnessScreenshots`
 * (multipart upload) stay on typed `fetch` — same binary/multipart rationale as `lib/api.ts`'s
 * module doc and `api-model-tests.ts`'s `exportModelTestRun`.
 */

export class RobustnessApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, error: ApiError["error"]) {
    super(error.message);
    this.name = "RobustnessApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

function unwrap<T>(result: { data: unknown; error: unknown; status: number }): T {
  return unwrapEdenAs<T, RobustnessApiError>(result, RobustnessApiError);
}

function robustnessUrl(jobId: string, suffix = ""): string {
  return `${API_PREFIX}/jobs/${jobId}/robustness${suffix}`;
}

export interface CreateRobustnessRunResponse {
  runId: string;
  status: "queued";
}

export interface RobustnessRunListItem {
  runId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  progress: { done: number; total: number };
  pdfTransforms: PdfTransform[];
  textTransforms: TextTransform[];
}

export async function createRobustnessRun(
  jobId: string,
  accessToken: string,
  input: RobustnessRequest,
): Promise<CreateRobustnessRunResponse> {
  const result = await eden.api.v1.jobs({ jobId }).robustness.post(input as never, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<CreateRobustnessRunResponse>(result);
}

export async function listRobustnessRuns(
  jobId: string,
  accessToken: string,
): Promise<{ runs: RobustnessRunListItem[] }> {
  const result = await eden.api.v1.jobs({ jobId }).robustness.get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<{ runs: RobustnessRunListItem[] }>(result);
}

export async function getRobustnessRun(
  jobId: string,
  accessToken: string,
  runId: string,
): Promise<RobustnessRun> {
  const result = await eden.api.v1
    .jobs({ jobId })
    .robustness({ runId })
    .get({
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  return unwrap<RobustnessRun>(result);
}

export async function deleteRobustnessRun(
  jobId: string,
  accessToken: string,
  runId: string,
): Promise<void> {
  const result = await eden.api.v1
    .jobs({ jobId })
    .robustness({ runId })
    .delete(undefined, {
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  if (result.status !== 204) {
    unwrap(result);
  }
}

export interface DownloadedRobustnessArtifact {
  blob: Blob;
  filename: string;
}

export async function downloadRobustnessArtifact(
  jobId: string,
  accessToken: string,
  runId: string,
  transform: string,
): Promise<DownloadedRobustnessArtifact> {
  const response = await fetch(robustnessUrl(jobId, `/${runId}/artifacts/${transform}`), {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    throw new RobustnessApiError(response.status, await readErrorPayload(response));
  }
  const blob = await response.blob();
  const filename = parseContentDispositionFilename(
    response.headers.get("Content-Disposition"),
    `${transform}.pdf`,
  );
  return { blob, filename };
}

export async function uploadRobustnessScreenshots(
  jobId: string,
  accessToken: string,
  files: File[],
): Promise<ScreenshotOcrResult> {
  const formData = new FormData();
  for (const file of files) formData.append("files[]", file);
  const response = await fetch(robustnessUrl(jobId, "/screenshots"), {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData,
  });
  if (!response.ok) {
    throw new RobustnessApiError(response.status, await readErrorPayload(response));
  }
  return (await response.json()) as ScreenshotOcrResult;
}
