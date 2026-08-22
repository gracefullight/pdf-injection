import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { readFormData, strField } from "../lib/multipart";
import { requireJob } from "../middleware/access-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { SubmissionsRepository } from "../repositories/submissions.repository";
import {
  createSubmission,
  deleteSubmission,
  getSubmission,
  getSubmissionStatistics,
  listSubmissions,
} from "../services/submission.service";

const MULTIPART_OVERHEAD_BYTES = 65_536; // 64 KiB

export interface SubmissionsRouteDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  submissionsRepo: SubmissionsRepository;
}

function withHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export function submissionsRoutes(deps: SubmissionsRouteDeps) {
  const { config, jobsRepo } = deps;

  return new Elysia()
    .onBeforeHandle(() => {
      // Defense in depth: contract §3 gates the ENTIRE submissions section
      // (not just POST) behind PS_RESEARCH_MODE. Each service function
      // (submission.service.ts) also checks this independently — this
      // route-level gate just fails closed before any request reaches a
      // handler at all, rather than relying solely on every service
      // function remembering to check.
      if (!config.researchMode) {
        throw new ApiError("RESEARCH_MODE_DISABLED");
      }
    })
    .post("/api/v1/jobs/:jobId/submissions", async ({ params, headers, request, set }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);

      const maxBytesWithOverhead = config.maxSubmissionBytes + MULTIPART_OVERHEAD_BYTES;
      const contentLength = Number(request.headers.get("content-length") ?? 0);
      if (contentLength > maxBytesWithOverhead) {
        throw new ApiError("FILE_TOO_LARGE");
      }
      const formData = await readFormData(request, maxBytesWithOverhead);

      const file = formData.get("file");
      const analysis = await createSubmission(deps, job, {
        file: file instanceof File ? file : null,
        text: strField(formData, "text"),
        label: strField(formData, "label"),
        acknowledgeNoRealStudentDataRaw: strField(formData, "acknowledgeNoRealStudentData"),
      });
      set.status = 201;
      return analysis;
    })
    .get("/api/v1/jobs/:jobId/submissions", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return listSubmissions(deps, job);
    })
    .get("/api/v1/jobs/:jobId/submissions/statistics", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return getSubmissionStatistics(deps, job);
    })
    .get("/api/v1/jobs/:jobId/submissions/:submissionId", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return getSubmission(deps, job, params.submissionId);
    })
    .delete("/api/v1/jobs/:jobId/submissions/:submissionId", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      await deleteSubmission(deps, job, params.submissionId);
      return withHeaders(new Response(null, { status: 204 }));
    });
}
