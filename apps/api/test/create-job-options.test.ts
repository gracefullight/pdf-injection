import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { MULTIPART_OVERHEAD_BYTES } from "../src/routes/jobs";
import { buildCreateJobRequest, DEFAULT_SIGNALS, fixtureFile, testApp } from "./helpers";

/** Emits `chunkCount` chunks of `chunkSize` zero-bytes, then closes. */
function bigBodyStream(chunkSize: number, chunkCount: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunkCount) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize));
      sent++;
    },
  });
}

describe("POST /api/v1/jobs - option handling", () => {
  test("position=custom without x/y -> 422 VALIDATION_ERROR", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        position: "custom",
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("position=custom with x/y -> completes", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        position: "custom",
        x: "50",
        y: "50",
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("completed");
  });

  test("targetPage=first resolves to pageIndex 0 on a multi-page fixture", async () => {
    const { app } = testApp();
    const file = await fixtureFile("five-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        targetPage: "first",
      }),
    );
    const created = await createRes.json();
    const statusRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${created.jobId}`, {
        headers: { "X-Job-Token": created.accessToken },
      }),
    );
    const status = await statusRes.json();
    expect(status.targetPage).toBe(0);
  });

  test("targetPage=3 (1-based) resolves to pageIndex 2", async () => {
    const { app } = testApp();
    const file = await fixtureFile("five-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        targetPage: "3",
      }),
    );
    const created = await createRes.json();
    const statusRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${created.jobId}`, {
        headers: { "X-Job-Token": created.accessToken },
      }),
    );
    const status = await statusRes.json();
    expect(status.targetPage).toBe(2);
  });

  test("targetPage=all reports every page and lands the payload on each one", async () => {
    const { app } = testApp();
    const file = await fixtureFile("five-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        targetPage: "all",
      }),
    );
    const created = await createRes.json();
    expect(created.status).toBe("completed");

    const statusRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${created.jobId}`, {
        headers: { "X-Job-Token": created.accessToken },
      }),
    );
    const status = await statusRes.json();
    // targetPage stays the first injected page so pre-existing readers still work.
    expect(status.targetPage).toBe(0);
    expect(status.targetPages).toEqual([0, 1, 2, 3, 4]);
    // targetPageMatch means *every* target page matched, not just the first.
    expect(status.summary.hiddenTextExtracted).toBe(true);

    const reportRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${created.jobId}/validation-report`, {
        headers: { "X-Job-Token": created.accessToken },
      }),
    );
    const report = await reportRes.json();
    expect(report.injection.pageIndexes).toEqual([0, 1, 2, 3, 4]);
    for (const page of report.serverValidation.textExtraction.pages) {
      expect(page.exactMatch || page.normalizedMatch).toBe(true);
    }
  });

  test("out-of-range targetPage -> 422 VALIDATION_ERROR", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
        targetPage: "99",
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("Content-Length fast-path rejects an oversized declared body before parsing", async () => {
    const { app } = testApp({ maxFileBytes: 1000 });
    const res = await app.handle(
      new Request("http://localhost/api/v1/jobs", {
        method: "POST",
        headers: {
          "content-length": String(1000 + MULTIPART_OVERHEAD_BYTES + 1),
          "content-type": "multipart/form-data; boundary=x",
        },
        body: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      }),
    );
    expect(res.status).toBe(413);
  });

  test("chunked/no-Content-Length oversized body is rejected via the streaming cap (413), no file written", async () => {
    const { app, config } = testApp({ maxFileBytes: 1000 });
    // No content-length header at all (as with chunked transfer-encoding) —
    // the fast-path header check is a no-op here; the streaming reader must
    // still abort once the accumulated body exceeds maxFileBytes + overhead.
    const req = new Request("http://localhost/api/v1/jobs", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: bigBodyStream(10_000, 20), // 200,000 bytes total >> 1000 + 65,536
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const res = await app.handle(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error.code).toBe("FILE_TOO_LARGE");
    expect(existsSync(config.storageDir)).toBe(false);
  });

  test("visible_positive_control mode: fontSize is forced to 9pt regardless of request", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const createRes = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "This is a visible research-control marker.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "visible_positive_control",
        fontSize: "2",
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const manifestRes = await app.handle(
      new Request(`http://localhost/api/v1/jobs/${created.jobId}/private-manifest`, {
        headers: { "X-Job-Token": created.accessToken },
      }),
    );
    const manifest = await manifestRes.json();
    expect(manifest.injection.fontSize).toBe(9);
  });
});
