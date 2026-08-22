import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sweepExpiredJobs } from "../src/services/job.service";
import { buildCreateJobRequest, DEFAULT_SIGNALS, fixtureFile, testApp } from "./helpers";

describe("retention sweeper", () => {
  test("sweepExpiredJobs deletes a job past its expiresAt", async () => {
    const { app, config } = testApp({ retentionHours: -1 }); // already expired on creation
    const file = await fixtureFile("one-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    const { jobId, accessToken } = await createRes.json();
    expect(existsSync(join(config.storageDir, jobId))).toBe(true);

    const { JobsRepository, createDatabase } = await import("../src/repositories/jobs.repository");
    const db = createDatabase(config.dbPath);
    const jobsRepo = new JobsRepository(db);

    const deletedCount = await sweepExpiredJobs({ config, jobsRepo });
    expect(deletedCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(config.storageDir, jobId))).toBe(false);

    const getRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(getRes.status).toBe(404);
  });

  test("does not delete a job with a future expiresAt", async () => {
    const { app, config } = testApp({ retentionHours: 24 });
    const file = await fixtureFile("one-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    const { jobId } = await createRes.json();

    const { JobsRepository, createDatabase } = await import("../src/repositories/jobs.repository");
    const db = createDatabase(config.dbPath);
    const jobsRepo = new JobsRepository(db);

    const deletedCount = await sweepExpiredJobs({ config, jobsRepo });
    expect(deletedCount).toBe(0);
    expect(existsSync(join(config.storageDir, jobId))).toBe(true);
  });
});
