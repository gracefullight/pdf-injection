import { isModelTestRequest } from "@pdf-injection/contracts";
import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import type { BackgroundRunner } from "../lib/background-runner";
import { requireJob } from "../middleware/access-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { RunsRepository } from "../repositories/runs.repository";
import {
  createModelTestRun,
  deleteModelTestRun,
  exportModelTestRun,
  getModelTestRun,
  listModelTestRuns,
} from "../services/model-test.service";

export interface ModelTestsRouteDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  runsRepo: RunsRepository;
  backgroundRunner: BackgroundRunner;
}

function withHeaders(response: Response): Response {
  for (const [key, value] of Object.entries(securityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export function modelTestsRoutes(deps: ModelTestsRouteDeps) {
  const { jobsRepo, config, runsRepo, backgroundRunner } = deps;
  const serviceDeps = { config, runsRepo, backgroundRunner };

  return new Elysia()
    .post("/api/v1/jobs/:jobId/model-tests", async ({ params, headers, request, set }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
      }
      if (!isModelTestRequest(body)) {
        throw new ApiError("VALIDATION_ERROR", "Request body does not match ModelTestRequest");
      }
      const result = await createModelTestRun(serviceDeps, job, body);
      set.status = 202;
      return result;
    })
    .get("/api/v1/jobs/:jobId/model-tests", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return listModelTestRuns(serviceDeps, job);
    })
    .get("/api/v1/jobs/:jobId/model-tests/:runId/export", async ({ params, headers, query }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      const format = query.format === "csv" ? "csv" : "json";
      const includeRaw = query.includeRaw === "true";
      const exported = await exportModelTestRun(serviceDeps, job, params.runId, format, includeRaw);
      return withHeaders(
        new Response(exported.body, {
          status: 200,
          headers: {
            "Content-Type": exported.contentType,
            "Content-Disposition": `attachment; filename="${exported.filename}"`,
          },
        }),
      );
    })
    .get("/api/v1/jobs/:jobId/model-tests/:runId", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return getModelTestRun(serviceDeps, job, params.runId);
    })
    .delete("/api/v1/jobs/:jobId/model-tests/:runId", async ({ params, headers }) => {
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      await deleteModelTestRun(serviceDeps, job, params.runId);
      return withHeaders(new Response(null, { status: 204 }));
    });
}
