import { isRobustnessRequest } from "@pdf-injection/contracts";
import { Elysia } from "elysia";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import type { BackgroundRunner } from "../lib/background-runner";
import { requireJob } from "../middleware/access-token";
import { securityHeaders } from "../middleware/security-headers";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { RunsRepository } from "../repositories/runs.repository";
import {
  analyzeScreenshots,
  createRobustnessRun,
  deleteRobustnessRun,
  getRobustnessArtifact,
  getRobustnessRun,
  listRobustnessRuns,
} from "../services/robustness.service";

export interface RobustnessRouteDeps {
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

function requireResearchMode(config: AppConfig): void {
  if (!config.researchMode) {
    throw new ApiError("RESEARCH_MODE_DISABLED");
  }
}

export function robustnessRoutes(deps: RobustnessRouteDeps) {
  const { jobsRepo, config, runsRepo, backgroundRunner } = deps;
  const serviceDeps = { config, runsRepo, backgroundRunner };

  return new Elysia()
    .post("/api/v1/jobs/:jobId/robustness", async ({ params, headers, request, set }) => {
      requireResearchMode(config);
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
      }
      if (!isRobustnessRequest(body)) {
        throw new ApiError("VALIDATION_ERROR", "Request body does not match RobustnessRequest");
      }
      const result = await createRobustnessRun(serviceDeps, job, body);
      set.status = 202;
      return result;
    })
    .get("/api/v1/jobs/:jobId/robustness", async ({ params, headers }) => {
      requireResearchMode(config);
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return listRobustnessRuns(serviceDeps, job);
    })
    .post("/api/v1/jobs/:jobId/robustness/screenshots", async ({ params, headers, request }) => {
      requireResearchMode(config);
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        throw new ApiError("VALIDATION_ERROR", "Request body is not valid multipart/form-data");
      }
      const files = formData
        .getAll("files[]")
        .filter((v): v is File => v instanceof File)
        .concat(formData.getAll("files").filter((v): v is File => v instanceof File));
      const result = await analyzeScreenshots(serviceDeps, job, files);
      return result;
    })
    .get(
      "/api/v1/jobs/:jobId/robustness/:runId/artifacts/:transform",
      async ({ params, headers }) => {
        requireResearchMode(config);
        const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
        const bytes = await getRobustnessArtifact(serviceDeps, job, params.runId, params.transform);
        return withHeaders(
          new Response(bytes as BodyInit, {
            status: 200,
            headers: { "Content-Type": "application/pdf" },
          }),
        );
      },
    )
    .get("/api/v1/jobs/:jobId/robustness/:runId", async ({ params, headers }) => {
      requireResearchMode(config);
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      return getRobustnessRun(serviceDeps, job, params.runId);
    })
    .delete("/api/v1/jobs/:jobId/robustness/:runId", async ({ params, headers }) => {
      requireResearchMode(config);
      const job = requireJob(jobsRepo, params.jobId, headers["x-job-token"]);
      await deleteRobustnessRun(serviceDeps, job, params.runId);
      return withHeaders(new Response(null, { status: 204 }));
    });
}
