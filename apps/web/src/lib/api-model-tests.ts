import type {
  ApiError,
  CreateRunResponse,
  ModelTestRequest,
  ModelTestRun,
  ModelTestRunListItem,
} from "@pdf-injection/contracts";
import { parseContentDispositionFilename } from "@/lib/content-disposition";
import { API_PREFIX, authHeaders, eden, readErrorPayload, unwrapEdenAs } from "@/lib/eden-client";

/**
 * Phase 3 (model-tests) API client. `apps/api/src/routes/model-tests.ts` is now registered on
 * the Elysia `App` type consumed by `treaty<App>()` (built once in `eden-client.ts`), so the
 * JSON endpoints (create/list/get/delete) go through Eden Treaty like the rest of `lib/api.ts`,
 * matched against the literal paths in
 * `.agents/results/api-contracts/pdf-injection-phase3-5-api.md` §2.
 *
 * `exportModelTestRun` stays on typed `fetch`: the export route returns a raw `Response`
 * (`Content-Type` switches between `application/json` and `text/csv` at runtime based on the
 * `format` query param, and it always carries a computed `Content-Disposition`), the same
 * category of route `lib/api.ts`'s module doc documents for the PDF artifact endpoints — Eden
 * has no static response type to hang a typed `Blob` decode off of here.
 */

export class ModelTestsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, error: ApiError["error"]) {
    super(error.message);
    this.name = "ModelTestsApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

function unwrap<T>(result: { data: unknown; error: unknown; status: number }): T {
  return unwrapEdenAs<T, ModelTestsApiError>(result, ModelTestsApiError);
}

function modelTestsUrl(jobId: string, suffix = ""): string {
  return `${API_PREFIX}/jobs/${jobId}/model-tests${suffix}`;
}

export async function createModelTestRun(
  jobId: string,
  accessToken: string,
  input: ModelTestRequest,
): Promise<CreateRunResponse> {
  const result = await eden.api.v1.jobs({ jobId })["model-tests"].post(input as never, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<CreateRunResponse>(result);
}

export async function listModelTestRuns(
  jobId: string,
  accessToken: string,
): Promise<{ runs: ModelTestRunListItem[] }> {
  const result = await eden.api.v1.jobs({ jobId })["model-tests"].get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<{ runs: ModelTestRunListItem[] }>(result);
}

export async function getModelTestRun(
  jobId: string,
  accessToken: string,
  runId: string,
): Promise<ModelTestRun> {
  const result = await eden.api.v1
    .jobs({ jobId })
    ["model-tests"]({ runId })
    .get({
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  return unwrap<ModelTestRun>(result);
}

export async function deleteModelTestRun(
  jobId: string,
  accessToken: string,
  runId: string,
): Promise<void> {
  const result = await eden.api.v1
    .jobs({ jobId })
    ["model-tests"]({ runId })
    .delete(undefined, {
      headers: authHeaders(accessToken) as Record<string, string>,
    });
  if (result.status !== 204) {
    unwrap(result);
  }
}

export interface DownloadedModelTestExport {
  blob: Blob;
  filename: string;
}

export async function exportModelTestRun(
  jobId: string,
  accessToken: string,
  runId: string,
  format: "json" | "csv",
  includeRaw = false,
): Promise<DownloadedModelTestExport> {
  const params = new URLSearchParams({ format });
  if (includeRaw) params.set("includeRaw", "true");
  const response = await fetch(modelTestsUrl(jobId, `/${runId}/export?${params.toString()}`), {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) {
    throw new ModelTestsApiError(response.status, await readErrorPayload(response));
  }
  const blob = await response.blob();
  const filename = parseContentDispositionFilename(
    response.headers.get("Content-Disposition"),
    `model-tests.${runId}.${format}`,
  );
  return { blob, filename };
}
