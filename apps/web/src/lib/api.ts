import type {
  ApiError,
  ClientValidationInput,
  CreateJobResponse,
  ExpectedSignal,
  HealthResponse,
  InjectionMode,
  JobStatusResponse,
  LintIssue,
  PayloadLanguage,
  Position,
  PrivateManifest,
  TargetPage,
  ValidationReport,
} from "@pdf-injection/contracts";
import { parseContentDispositionFilename } from "@/lib/content-disposition";
import {
  API_PREFIX,
  authHeaders,
  eden,
  edenHeader,
  readErrorPayload,
  unwrapEdenAs,
} from "@/lib/eden-client";
import {
  applyLocalClientValidation,
  deleteLocalJob,
  localJobStatus,
  putLocalJob,
  requireLocalJob,
} from "@/lib/local-job/local-job-store";
import { isLocalJobId, runLocalJob } from "@/lib/local-job/run-local-job";
import { isLocalModeEnabled } from "@/lib/local-mode";

export { API_PREFIX, authHeaders, resolveEdenDomain } from "@/lib/eden-client";

/**
 * API client boundary around the PDF Injection jobs API.
 *
 * JSON endpoints across every route module (jobs/health, plus round-2's
 * model-tests/robustness/variant-sets/student-keyed-sets/submissions in
 * `api-model-tests.ts` / `api-robustness.ts` / `api-variant-sets.ts` /
 * `api-submissions.ts`) go through Eden Treaty (`treaty<App>`, built in
 * `eden-client.ts`), typed against the Elysia `App` type exported by
 * `@pdf-injection/api` (type-only import — erased at build time, never
 * bundles server code; verified via `bunx tsc --noEmit` and a `vite`
 * dev-server module-graph check, see task-5 result file).
 *
 * Binary PDF bytes (source/output) stay on raw `fetch`: `apps/api`'s artifact
 * routes construct a low-level DOM `Response` directly (`pdfResponse()` in
 * `apps/api/src/routes/jobs.ts`) rather than returning a value through Elysia's
 * schema/body system, so Eden has no static response type to hang a `Blob`
 * decode off of for these two routes specifically — raw `fetch` + `.blob()` /
 * `.arrayBuffer()` is simpler and exactly matches prior behavior byte-for-byte.
 * This module remains the single boundary all callers go through, so no
 * component code changed as part of this swap. Multipart/binary/CSV/ZIP
 * endpoints in the round-2 modules stay on `fetch` for the same reason (see
 * each module's own doc comment for exactly which routes and why).
 */

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, error: ApiError["error"]) {
    super(error.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

/** Narrows an Eden Treaty `{data, error}` result into `T`, throwing `ApiRequestError` on failure. */
export function unwrapEden<T>(result: { data: unknown; error: unknown; status: number }): T {
  return unwrapEdenAs<T, ApiRequestError>(result, ApiRequestError);
}

export interface CreateJobInput {
  file: File;
  instruction: string;
  expectedSignals: ExpectedSignal[];
  injectionMode: InjectionMode;
  /**
   * On-device multi-channel selection. When it has more than one entry the
   * local runner injects every listed mode into one PDF (`injectionMode` is the
   * primary/first entry). The server path ignores it and uses `injectionMode`
   * only — multi-channel is on-device only for now.
   */
  injectionModes?: InjectionMode[];
  targetPage?: TargetPage;
  position?: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  payloadLanguage?: PayloadLanguage;
  acknowledgedWarnings?: string[];
}

export async function createJob(input: CreateJobInput): Promise<CreateJobResponse> {
  // Local (server-free) mode: run the whole pipeline on-device. Every function
  // below then serves that job from the in-memory store instead of the API, so
  // the wizard, the validation screen and the download buttons are unchanged.
  if (isLocalModeEnabled()) {
    const { job, response } = await runLocalJob(input);
    putLocalJob(job);
    return response;
  }

  const fields: Record<string, string | File> = {
    file: input.file,
    instruction: input.instruction,
    expectedSignals: JSON.stringify(input.expectedSignals),
    injectionMode: input.injectionMode,
  };
  if (input.targetPage !== undefined) fields.targetPage = String(input.targetPage);
  if (input.position !== undefined) fields.position = input.position;
  if (input.x !== undefined) fields.x = String(input.x);
  if (input.y !== undefined) fields.y = String(input.y);
  if (input.fontSize !== undefined) fields.fontSize = String(input.fontSize);
  if (input.maxWidth !== undefined) fields.maxWidth = String(input.maxWidth);
  if (input.payloadLanguage !== undefined) fields.payloadLanguage = input.payloadLanguage;
  if (input.acknowledgedWarnings !== undefined) {
    fields.acknowledgedWarnings = JSON.stringify(input.acknowledgedWarnings);
  }

  // Eden Treaty auto-detects the `File` value in this object and serializes the
  // whole body as multipart/form-data (matches the contract's `multipart/form-data`
  // requirement for POST /api/v1/jobs without hand-building a FormData instance).
  const result = await eden.api.v1.jobs.post(fields as never);
  return unwrapEden<CreateJobResponse>(result);
}

export async function getJobStatus(jobId: string, accessToken: string): Promise<JobStatusResponse> {
  if (isLocalJobId(jobId)) return localJobStatus(jobId);
  const result = await eden.api.v1
    .jobs({ jobId })
    .get({ headers: authHeaders(accessToken) as Record<string, string> });
  return unwrapEden<JobStatusResponse>(result);
}

export async function postClientValidation(
  jobId: string,
  accessToken: string,
  input: ClientValidationInput,
): Promise<JobStatusResponse> {
  if (isLocalJobId(jobId)) {
    applyLocalClientValidation(jobId, input);
    return localJobStatus(jobId);
  }
  const result = await eden.api.v1.jobs({ jobId })["client-validation"].post(input as never, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrapEden<JobStatusResponse>(result);
}

export async function getPrivateManifest(
  jobId: string,
  accessToken: string,
): Promise<PrivateManifest> {
  if (isLocalJobId(jobId)) return requireLocalJob(jobId).manifest;
  const result = await eden.api.v1.jobs({ jobId })["private-manifest"].get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrapEden<PrivateManifest>(result);
}

export async function getValidationReport(
  jobId: string,
  accessToken: string,
): Promise<ValidationReport> {
  if (isLocalJobId(jobId)) return requireLocalJob(jobId).report;
  const result = await eden.api.v1.jobs({ jobId })["validation-report"].get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrapEden<ValidationReport>(result);
}

export async function deleteJob(jobId: string, accessToken: string): Promise<void> {
  if (isLocalJobId(jobId)) {
    deleteLocalJob(jobId);
    return;
  }
  const result = await eden.api.v1.jobs({ jobId }).delete(undefined, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  if (result.status !== 204) {
    unwrapEden(result);
  }
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** Same pretty-printed JSON artifact the server serves, built from an in-memory local job. */
function jsonFile(data: unknown, filename: string): DownloadedFile {
  return {
    blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename,
  };
}

/**
 * Binary artifact (PDF) download via raw `fetch` — see module doc comment for
 * why `apps/api`'s `application/pdf` responses (constructed as raw DOM
 * `Response` objects, not through Elysia's schema/body system) stay off Eden.
 */
async function downloadPdfLike(
  url: string,
  accessToken: string,
  fallbackFilename: string,
): Promise<DownloadedFile> {
  const response = await fetch(url, { headers: authHeaders(accessToken) });
  if (!response.ok) {
    await throwFetchError(response);
  }
  const blob = await response.blob();
  const filename = parseContentDispositionFilename(
    response.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  return { blob, filename };
}

/**
 * Downloads a JSON artifact (private manifest / validation report) through
 * Eden Treaty, then re-serializes `data` into a `Blob` for the browser
 * download — keeping these two JSON endpoints on the same Eden Treaty path as
 * every other JSON call in this module (only the two `application/pdf`
 * binary routes above stay on raw `fetch`).
 */
async function downloadJsonArtifact<T>(
  result: { data: unknown; error: unknown; status: number; headers: unknown },
  fallbackFilename: string,
): Promise<DownloadedFile> {
  const data = unwrapEden<T>(result);
  const filename = parseContentDispositionFilename(
    edenHeader(result.headers, "content-disposition"),
    fallbackFilename,
  );
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  return { blob, filename };
}

/** Exported for reuse by `api-model-tests.ts` / `api-robustness.ts` (see `API_PREFIX` doc comment). */
export async function throwFetchError(response: Response): Promise<never> {
  throw new ApiRequestError(response.status, await readErrorPayload(response));
}

export function getSourcePdfUrl(jobId: string): string {
  return `${API_PREFIX}/jobs/${jobId}/source`;
}

export function getOutputPdfUrl(jobId: string): string {
  return `${API_PREFIX}/jobs/${jobId}/output`;
}

/** Fetches the source PDF bytes (used by Human View / Visual Diff to render the original). */
export async function fetchSourcePdfBytes(jobId: string, accessToken: string): Promise<Uint8Array> {
  if (isLocalJobId(jobId)) return requireLocalJob(jobId).sourceBytes;
  const response = await fetch(getSourcePdfUrl(jobId), { headers: authHeaders(accessToken) });
  if (!response.ok) {
    await throwFetchError(response);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Fetches the output PDF bytes (used by Human View / Visual Diff / Extracted Text). */
export async function fetchOutputPdfBytes(jobId: string, accessToken: string): Promise<Uint8Array> {
  if (isLocalJobId(jobId)) return requireLocalJob(jobId).outputBytes;
  const response = await fetch(getOutputPdfUrl(jobId), { headers: authHeaders(accessToken) });
  if (!response.ok) {
    await throwFetchError(response);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function downloadOutputPdf(
  jobId: string,
  accessToken: string,
  sourceStem: string,
): Promise<DownloadedFile> {
  const filename = `${sourceStem}.injected.pdf`;
  if (isLocalJobId(jobId)) {
    const blob = new Blob([requireLocalJob(jobId).outputBytes as BlobPart], {
      type: "application/pdf",
    });
    return { blob, filename };
  }
  return downloadPdfLike(getOutputPdfUrl(jobId), accessToken, filename);
}

export async function downloadPrivateManifest(
  jobId: string,
  accessToken: string,
  sourceStem: string,
): Promise<DownloadedFile> {
  const filename = `${sourceStem}.private-manifest.json`;
  if (isLocalJobId(jobId)) return jsonFile(requireLocalJob(jobId).manifest, filename);
  const result = await eden.api.v1.jobs({ jobId })["private-manifest"].get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return downloadJsonArtifact<PrivateManifest>(result, filename);
}

export async function downloadValidationReport(
  jobId: string,
  accessToken: string,
  sourceStem: string,
): Promise<DownloadedFile> {
  const filename = `${sourceStem}.validation-report.json`;
  if (isLocalJobId(jobId)) return jsonFile(requireLocalJob(jobId).report, filename);
  const result = await eden.api.v1.jobs({ jobId })["validation-report"].get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return downloadJsonArtifact<ValidationReport>(result, filename);
}

/** Triggers a browser download for an already-fetched blob via a temporary object URL. */
export function triggerBrowserDownload(file: DownloadedFile): void {
  const objectUrl = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(objectUrl);
}

export async function getHealth(): Promise<HealthResponse> {
  const result = await eden.api.v1.health.get();
  return unwrapEden<HealthResponse>(result);
}

// Phase 3/5 endpoints (model-tests / robustness) — see api-model-tests.ts / api-robustness.ts
// module docs for why they stay on typed `fetch` instead of Eden for now.
export * from "@/lib/api-model-tests";
export * from "@/lib/api-robustness";
export * from "@/lib/api-submissions";

// Phase 5 variant-sets/student-keyed-sets + Phase 4 submissions — see
// api-variant-sets.ts / api-submissions.ts / research-fetch.ts module docs
// for why they stay on typed `fetch` instead of Eden for now.
export * from "@/lib/api-variant-sets";
export type { LintIssue };
