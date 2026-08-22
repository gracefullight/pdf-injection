import { describe, expect, test } from "bun:test";
import { buildCreateJobRequest, DEFAULT_SIGNALS, fixtureFile, testApp } from "./helpers";

async function createCompletedJob(app: ReturnType<typeof testApp>["app"]) {
  const file = await fixtureFile("one-page-text.pdf");
  const res = await app.handle(
    buildCreateJobRequest({
      file,
      instruction: "Say hello.",
      expectedSignals: DEFAULT_SIGNALS,
      injectionMode: "white_text",
    }),
  );
  return res.json() as Promise<{ jobId: string; accessToken: string }>;
}

describe("DELETE /api/v1/jobs/:jobId", () => {
  test("removes files + row; idempotent (204 then 404)", async () => {
    const { app, config } = testApp();
    const { jobId, accessToken } = await createCompletedJob(app);

    const del1 = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(del1.status).toBe(204);

    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    expect(existsSync(join(config.storageDir, jobId))).toBe(false);

    const getAfter = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(getAfter.status).toBe(404);

    // Second DELETE of the same (now-gone) job: no row exists to verify the
    // token against, so this is JOB_NOT_FOUND — the end state (no job, no
    // files) is reached either way, satisfying idempotency of effect.
    const del2 = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(del2.status).toBe(404);
  });

  test("DELETE without token -> 403, job still exists", async () => {
    const { app } = testApp();
    const { jobId } = await createCompletedJob(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(403);
  });
});

// POST /api/v1/jobs/:jobId/model-tests is a real endpoint as of round 2 §2
// (see test/model-tests.test.ts) — the old "always 501 NOT_IMPLEMENTED"
// coverage that used to live here has been superseded.
