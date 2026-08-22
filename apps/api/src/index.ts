import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { type AppConfig, loadConfig } from "./config";
import { BackgroundRunner } from "./lib/background-runner";
import { mapError } from "./middleware/error-mapper";
import { corsOptions, securityHeaders } from "./middleware/security-headers";
import { createDatabase, JobsRepository } from "./repositories/jobs.repository";
import { RunsRepository } from "./repositories/runs.repository";
import { SubmissionsRepository } from "./repositories/submissions.repository";
import { VariantSetsRepository } from "./repositories/variant-sets.repository";
import { healthRoutes } from "./routes/health";
import { jobsRoutes } from "./routes/jobs";
import { modelTestsRoutes } from "./routes/model-tests";
import { robustnessRoutes } from "./routes/robustness";
import { studentKeyedSetsRoutes } from "./routes/student-keyed-sets";
import { submissionsRoutes } from "./routes/submissions";
import { variantSetsRoutes } from "./routes/variant-sets";
import { sweepExpiredJobs } from "./services/job.service";
import { sweepExpiredSets } from "./services/variant-set.service";

/**
 * Builds the Elysia app (no `.listen()` — testable via `app.handle(request)`).
 * Wires: bun:sqlite migration, CORS for the Vite dev origin, global security
 * headers, the centralized error mapper, all routes, and an unref'd
 * retention sweeper interval (so it never blocks process/test exit).
 */
export function createApp(config: AppConfig = loadConfig()) {
  const db = createDatabase(config.dbPath);
  const jobsRepo = new JobsRepository(db);
  jobsRepo.migrate();
  const variantSetsRepo = new VariantSetsRepository(db);
  variantSetsRepo.migrate();
  const submissionsRepo = new SubmissionsRepository(db);
  submissionsRepo.migrate();
  // model_test_runs / robustness_runs — migrate() also turns on
  // `PRAGMA foreign_keys` on this connection so their `job_id REFERENCES
  // jobs(id) ON DELETE CASCADE` actually cascades: deleting a job (existing
  // jobsRepo.delete()) removes its run rows too with zero changes needed
  // elsewhere in job.service.ts's deleteJob().
  const runsRepo = new RunsRepository(db);
  runsRepo.migrate();
  const backgroundRunner = new BackgroundRunner();

  const deps = { config, jobsRepo, variantSetsRepo, submissionsRepo, runsRepo, backgroundRunner };

  const app = new Elysia()
    .use(cors(corsOptions(config)))
    .onRequest(({ set }) => {
      for (const [key, value] of Object.entries(securityHeaders())) {
        set.headers[key] = value;
      }
    })
    .onError(({ error, code, set }) => {
      const mapped = mapError(error, code);
      if (mapped.status === 500) {
        // Narrow, deliberate logging: name + message only, never the full
        // error object / stack / request body — consistent with "never log
        // instruction text" even though no current exception type carries it.
        console.error("Unhandled error:", (error as Error)?.name, (error as Error)?.message);
      }
      set.status = mapped.status;
      return mapped.body;
    })
    .use(healthRoutes(config))
    .use(jobsRoutes(deps))
    .use(modelTestsRoutes(deps))
    .use(robustnessRoutes(deps))
    .use(variantSetsRoutes(deps))
    .use(studentKeyedSetsRoutes(deps))
    .use(submissionsRoutes(deps));

  const sweepInterval = setInterval(() => {
    sweepExpiredJobs(deps).catch((err) => {
      console.error("Retention sweep failed:", (err as Error).name);
    });
    // Round-2 §1: variant-sets / student-keyed sets have their own
    // expires_at (set-level storage — distribution.json/mapping.json —
    // isn't inside any single member job's dir), so they need their own
    // sweep alongside sweepExpiredJobs.
    sweepExpiredSets(deps).catch((err) => {
      console.error("Set retention sweep failed:", (err as Error).name);
    });
  }, config.sweepIntervalMs);
  sweepInterval.unref?.();

  return app;
}

export type App = ReturnType<typeof createApp>;

if (import.meta.main) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port);
  console.log(`PDF Injection API listening on http://localhost:${config.port}`);
}
