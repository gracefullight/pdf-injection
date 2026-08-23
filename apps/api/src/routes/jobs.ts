import type { ClientValidationInput } from "@pdf-injection/contracts";
import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { requireJob } from "../middleware/access-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { VariantSetsRepository } from "../repositories/variant-sets.repository";
import {
  type CreateJobFields,
  createJob,
  deleteJob,
  getJobStatus,
  getOutputPdf,
  getPrivateManifest,
  getSourcePdf,
  getValidationReport,
  postClientValidation,
} from "../services/job.service";

// Slack allowance (beyond the max PDF file size) for the other multipart
// fields in a POST /jobs request (instruction, expectedSignals JSON, etc).
export const MULTIPART_OVERHEAD_BYTES = 65_536; // 64 KiB

function str(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
}

/**
 * Reads a request body while streaming, aborting with FILE_TOO_LARGE the
 * moment the accumulated size exceeds `maxBytes`. This is the real size
 * guard: a declared `Content-Length` can be spoofed or simply absent
 * (chunked transfer-encoding), so relying on the header alone would let a
 * client force the server to buffer an arbitrarily large body via
 * `request.formData()` before the post-parse byte-length check ever runs.
 */
async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError("FILE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function extractCreateJobFields(
  request: Request,
  maxBytes: number,
): Promise<CreateJobFields> {
  const bodyBytes = await readBodyWithLimit(request, maxBytes);
  const reconstructed = new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: bodyBytes as BodyInit,
  });

  let formData: FormData;
  try {
    formData = await reconstructed.formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body is not valid multipart/form-data");
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ApiError("VALIDATION_ERROR", "file field is required and must be a PDF file");
  }
  const instruction = formData.get("instruction");
  if (typeof instruction !== "string") {
    throw new ApiError("VALIDATION_ERROR", "instruction field is required");
  }
  // Optional: signals are only needed by the scoring features (Model Test,
  // Submissions, Robustness) — see apps/api/src/lib/expected-signals.ts.
  const expectedSignalsField = formData.get("expectedSignals");
  if (expectedSignalsField !== null && typeof expectedSignalsField !== "string") {
    throw new ApiError("VALIDATION_ERROR", "expectedSignals must be a JSON string");
  }
  const expectedSignalsJson = expectedSignalsField ?? "[]";
  const injectionMode = formData.get("injectionMode");
  if (typeof injectionMode !== "string") {
    throw new ApiError("VALIDATION_ERROR", "injectionMode field is required");
  }

  return {
    file,
    instruction,
    expectedSignalsJson,
    injectionMode,
    targetPageRaw: str(formData, "targetPage"),
    positionRaw: str(formData, "position"),
    xRaw: str(formData, "x"),
    yRaw: str(formData, "y"),
    fontSizeRaw: str(formData, "fontSize"),
    maxWidthRaw: str(formData, "maxWidth"),
    acknowledgedWarningsRaw: str(formData, "acknowledgedWarnings"),
    payloadLanguageRaw: str(formData, "payloadLanguage"),
  };
}

function withHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

function pdfResponse(bytes: Uint8Array, filename?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/pdf" };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename}"`;
  return withHeaders(new Response(bytes as BodyInit, { status: 200, headers }));
}

function jsonDownloadResponse(body: unknown, filename: string): Response {
  return withHeaders(
    new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    }),
  );
}

function isValidClientValidationInput(value: unknown): value is ClientValidationInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.pdfJsVersion !== "string") return false;
  if (typeof v.renderPassed !== "boolean") return false;
  if (!Array.isArray(v.renderErrors)) return false;
  const vd = v.visualDiff as Record<string, unknown> | undefined;
  if (typeof vd !== "object" || vd === null) return false;
  if (!Array.isArray(vd.pages)) return false;
  if (typeof vd.changedPixelRatio !== "number") return false;
  if (typeof vd.passed !== "boolean") return false;
  const et = v.extractedText as Record<string, unknown> | undefined;
  if (typeof et !== "object" || et === null) return false;
  if (!Array.isArray(et.pages)) return false;
  if (typeof et.targetPageMatch !== "boolean") return false;
  if (typeof et.anyPageMatch !== "boolean") return false;
  return true;
}

export interface JobsRouteDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  /**
   * Optional: when supplied, `requireJob()` also accepts the token of the
   * variant-set / student-keyed set that owns a given job (round-2 §1, UX
   * C-02 — "Open variant/student" dialog). Omitting it (e.g. in tests that
   * construct `JobsRouteDeps` directly without a full app) preserves the
   * original member-token-only behavior.
   */
  variantSetsRepo?: VariantSetsRepository;
}

export function jobsRoutes(deps: JobsRouteDeps) {
  const { config, jobsRepo, variantSetsRepo } = deps;

  return (
    new Elysia()
      .post("/api/v1/jobs", async ({ request, set }) => {
        const maxBytesWithOverhead = config.maxFileBytes + MULTIPART_OVERHEAD_BYTES;
        // Fast path: reject outright when Content-Length is declared and
        // already over the limit, before touching the body at all.
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > maxBytesWithOverhead) {
          throw new ApiError("FILE_TOO_LARGE");
        }
        // Real guard: streams the body with a hard cap, so a chunked request
        // (or one that simply omits Content-Length) can't force the server to
        // buffer an oversized payload before the limit is enforced.
        const fields = await extractCreateJobFields(request, maxBytesWithOverhead);
        const result = await createJob(deps, fields);
        set.status = 201;
        return result;
      })
      .get("/api/v1/jobs/:jobId", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        return getJobStatus(deps, job);
      })
      .get("/api/v1/jobs/:jobId/source", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        const { bytes } = await getSourcePdf(deps, job);
        return pdfResponse(bytes);
      })
      .get("/api/v1/jobs/:jobId/output", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        const { bytes, filename } = await getOutputPdf(deps, job);
        return pdfResponse(bytes, filename);
      })
      .get("/api/v1/jobs/:jobId/private-manifest", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        const { manifest, filename } = await getPrivateManifest(deps, job);
        return jsonDownloadResponse(manifest, filename);
      })
      .get("/api/v1/jobs/:jobId/validation-report", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        const { report, filename } = await getValidationReport(deps, job);
        return jsonDownloadResponse(report, filename);
      })
      .post("/api/v1/jobs/:jobId/client-validation", async ({ params, headers, request }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
        }
        if (!isValidClientValidationInput(body)) {
          throw new ApiError(
            "VALIDATION_ERROR",
            "Request body does not match ClientValidationInput",
          );
        }
        return postClientValidation(deps, job, body);
      })
      // POST /jobs/:jobId/model-tests is now a real endpoint (round 2 §2) —
      // see routes/model-tests.ts, registered separately in src/index.ts.
      .delete("/api/v1/jobs/:jobId", async ({ params, headers }) => {
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"], variantSetsRepo);
        await deleteJob(deps, job.id);
        return withHeaders(new Response(null, { status: 204 }));
      })
  );
}
