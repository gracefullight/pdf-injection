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

describe("X-Job-Token guard", () => {
  test("GET status without token -> 403 JOB_FORBIDDEN", async () => {
    const { app } = testApp();
    const { jobId } = await createCompletedJob(app);
    const res = await app.handle(new Request(`http://localhost/api/v1/jobs/${jobId}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("JOB_FORBIDDEN");
  });

  test("GET status with wrong token -> 403 JOB_FORBIDDEN", async () => {
    const { app } = testApp();
    const { jobId } = await createCompletedJob(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        headers: { "X-Job-Token": "wrong-token-value" },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("JOB_FORBIDDEN");
  });

  test("GET status for unknown job id -> 404 JOB_NOT_FOUND", async () => {
    const { app } = testApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/jobs/00000000-0000-4000-8000-000000000000", {
        headers: { "X-Job-Token": "irrelevant" },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("JOB_NOT_FOUND");
  });

  test("GET status for malformed job id -> 404 JOB_NOT_FOUND (path traversal guard)", async () => {
    const { app } = testApp();
    const res = await app.handle(
      new Request("http://localhost/api/v1/jobs/../../etc/passwd", {
        headers: { "X-Job-Token": "x" },
      }),
    );
    expect([404, 400]).toContain(res.status);
  });

  test("GET status with correct token -> 200", async () => {
    const { app } = testApp();
    const { jobId, accessToken } = await createCompletedJob(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}`, {
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(res.status).toBe(200);
  });
});
