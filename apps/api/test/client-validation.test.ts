import { describe, expect, test } from "bun:test";
import { buildCreateJobRequest, DEFAULT_SIGNALS, fixtureFile, testApp } from "./helpers";

function makeClientValidation(
  overrides: Partial<{ renderPassed: boolean; changedPixelRatio: number }> = {},
) {
  return {
    pdfJsVersion: "4.10.38",
    renderPassed: overrides.renderPassed ?? true,
    renderErrors: [] as string[],
    visualDiff: {
      scale: 2,
      thresholdRatio: 0.00001,
      pages: [
        {
          pageIndex: 0,
          width: 612,
          height: 792,
          changedPixels: 0,
          changedPixelRatio: overrides.changedPixelRatio ?? 0,
          maxChannelDelta: 0,
          meanAbsoluteDifference: 0,
          passed: true,
        },
      ],
      changedPixelRatio: overrides.changedPixelRatio ?? 0,
      passed: true,
    },
    extractedText: {
      pages: [
        {
          pageIndex: 0,
          textLength: 100,
          exactMatch: true,
          normalizedMatch: true,
          caseInsensitiveMatch: true,
          matchOffset: 10,
        },
      ],
      targetPageMatch: true,
      anyPageMatch: true,
    },
  };
}

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

describe("POST /api/v1/jobs/:jobId/client-validation", () => {
  test("merges render/diff/extraction and recomputes overall to PASS", async () => {
    const { app } = testApp();
    const { jobId, accessToken } = await createCompletedJob(app);

    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/client-validation`, {
        method: "POST",
        headers: { "X-Job-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(makeClientValidation()),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.pdfJsRenderPassed).toBe(true);
    expect(body.summary.changedPixelRatio).toBe(0);
    expect(["PASS", "PASS_WITH_WARNINGS"]).toContain(body.summary.overall);

    const reportRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/validation-report`, {
        headers: { "X-Job-Token": accessToken },
      }),
    );
    const report = await reportRes.json();
    expect(report.clientValidation.renderPassed).toBe(true);
  });

  test("renderPassed=false recomputes overall to FAIL and blocks GET /output with 422 RENDER_FAILED", async () => {
    const { app } = testApp();
    const { jobId, accessToken } = await createCompletedJob(app);

    const cvRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/client-validation`, {
        method: "POST",
        headers: { "X-Job-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify(makeClientValidation({ renderPassed: false })),
      }),
    );
    expect(cvRes.status).toBe(200);
    const body = await cvRes.json();
    expect(body.summary.overall).toBe("FAIL");

    const outputRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/output`, {
        headers: { "X-Job-Token": accessToken },
      }),
    );
    expect(outputRes.status).toBe(422);
    const outBody = await outputRes.json();
    expect(outBody.error.code).toBe("RENDER_FAILED");
  });

  test("malformed body -> 422 VALIDATION_ERROR", async () => {
    const { app } = testApp();
    const { jobId, accessToken } = await createCompletedJob(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/client-validation`, {
        method: "POST",
        headers: { "X-Job-Token": accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ nope: true }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("without token -> 403", async () => {
    const { app } = testApp();
    const { jobId } = await createCompletedJob(app);
    const res = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${jobId}/client-validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeClientValidation()),
      }),
    );
    expect(res.status).toBe(403);
  });
});
