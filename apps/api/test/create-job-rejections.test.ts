import { describe, expect, test } from "bun:test";
import { buildCreateJobRequest, DEFAULT_SIGNALS, fixtureFile, testApp } from "./helpers";

async function expectRejection(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(body.error.code).toBe(code);
}

describe("POST /api/v1/jobs - pre-processing rejections (no job row, no files)", () => {
  test("INVALID_PDF: non-PDF bytes", async () => {
    const { app } = testApp();
    const file = await fixtureFile("not-a-pdf.bin", "application/pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 400, "INVALID_PDF");
  });

  test("PDF_ENCRYPTED", async () => {
    const { app } = testApp();
    const file = await fixtureFile("encrypted.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PDF_ENCRYPTED");
  });

  test("PDF_SIGNED", async () => {
    const { app } = testApp();
    const file = await fixtureFile("signed-like.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PDF_SIGNED");
  });

  test("FILE_TOO_LARGE", async () => {
    const { app } = testApp({ maxFileBytes: 100 });
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 413, "FILE_TOO_LARGE");
  });

  test("TOO_MANY_PAGES", async () => {
    const { app } = testApp({ maxPages: 1 });
    const file = await fixtureFile("five-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "TOO_MANY_PAGES");
  });

  test("PROMPT_TOO_LONG", async () => {
    const { app } = testApp({ maxInstructionChars: 10 });
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "This instruction is definitely longer than ten characters.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PROMPT_TOO_LONG");
  });

  test("PROMPT_ENCODING_FAILED: null byte", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello \0 there.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PROMPT_ENCODING_FAILED");
  });

  test("PROMPT_ENCODING_FAILED: non-ASCII", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say héllo there.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PROMPT_ENCODING_FAILED");
  });

  test("PROMPT_LINT_ERROR: empty instruction", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "   ",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    await expectRejection(res, 422, "PROMPT_LINT_ERROR");
  });

  test("empty expectedSignals is accepted (optional at generation) with a no_expected_signals warning", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: [],
        injectionMode: "white_text",
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { lintWarnings: Array<{ id: string }> };
    expect(body.lintWarnings.map((w) => w.id)).toContain("no_expected_signals");
  });

  test("VALIDATION_ERROR: malformed expectedSignals JSON", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const form = new FormData();
    form.set("file", file);
    form.set("instruction", "Say hello.");
    form.set("expectedSignals", "{not valid json");
    form.set("injectionMode", "white_text");
    const res = await app.handle(
      new Request("http://localhost/api/v1/jobs", { method: "POST", body: form }),
    );
    await expectRejection(res, 422, "VALIDATION_ERROR");
  });

  test("VALIDATION_ERROR: missing instruction field", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const form = new FormData();
    form.set("file", file);
    form.set("expectedSignals", JSON.stringify(DEFAULT_SIGNALS));
    form.set("injectionMode", "white_text");
    const res = await app.handle(
      new Request("http://localhost/api/v1/jobs", { method: "POST", body: form }),
    );
    await expectRejection(res, 422, "VALIDATION_ERROR");
  });

  test("VALIDATION_ERROR: invalid injectionMode", async () => {
    const { app } = testApp();
    const file = await fixtureFile("one-page-text.pdf");
    const res = await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "not_a_real_mode" as never,
      }),
    );
    await expectRejection(res, 422, "VALIDATION_ERROR");
  });

  test("pre-processing rejection creates no job row (GET on any subsequent id-shaped path is untouched)", async () => {
    const { app, config } = testApp();
    const file = await fixtureFile("not-a-pdf.bin", "application/pdf");
    await app.handle(
      buildCreateJobRequest({
        file,
        instruction: "Say hello.",
        expectedSignals: DEFAULT_SIGNALS,
        injectionMode: "white_text",
      }),
    );
    const { existsSync } = await import("node:fs");
    expect(existsSync(config.storageDir)).toBe(false);
  });
});
