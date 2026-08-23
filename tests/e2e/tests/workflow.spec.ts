import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  API_BASE_URL,
  continueToGenerateAndSubmit,
  DOD_INSTRUCTION,
  DOWNLOAD_DIR,
  fillInstructionAndSignals,
  readJobCredentials,
  SCREENSHOT_DIR,
  screenshotEachValidationTab,
  selectRadixOption,
  uploadFixtureAndContinue,
  waitForOverallLeavesNotTested,
} from "./helpers";

const API_BASE = API_BASE_URL;

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
});

/**
 * PRD §22.4 E2E workflow (white_text mode) + most of §29 Definition-of-Done
 * items 1-12 and 15. Covers: upload -> instruction -> expected signals ->
 * mode/target/position -> generate -> validation tabs -> download output PDF
 * + private manifest + validation report -> delete job -> verify the job is
 * gone server-side.
 */
test("full workflow: white_text mode, generate, validate, download, delete", async ({
  page,
  request,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  // white_text / last page / bottom margin are all DEFAULT_INJECTION_SETTINGS
  // (apps/web/src/features/instruction-editor/instruction-types.ts) — DoD §29
  // step 5 asks for exactly these defaults, so no injection-settings changes
  // are needed for this test.
  await continueToGenerateAndSubmit(page);

  // DoD §29 item 6: "새 PDF가 생성된다" — validation-screen rendering at all
  // proves POST /api/v1/jobs returned status:"completed" (job.service.ts only
  // reaches the client if injectPdf()+server validation succeeded).
  await expect(page.getByTestId("validation-screen")).toBeVisible();

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[white_text] overall status: ${overall}`);
  // DoD items 7-11 (pdf-lib round-trip, PDF.js render, page count/geometry
  // preserved, instruction found in extracted text, visual diff under
  // threshold) are exactly what feeds the overall computation — FAIL would
  // mean at least one of them failed, so asserting it's not FAIL is the
  // UI-level proxy; the validation-report.json parsed below gives per-field
  // evidence for the result file.
  expect(["PASS", "PASS_WITH_WARNINGS"]).toContain(overall);

  // Extracted Text tab: white_text mode must show the instruction was found
  // (DoD item 10). ExtractedTextTab defaults its selected page to the target
  // page, so the match-status block for the target page is visible immediately.
  await page.getByTestId("tab-extracted-text").click();
  await expect(page.getByTestId("extracted-text-disclaimer")).toBeVisible();
  const matchStatus = page.getByTestId("extracted-text-match-status");
  await expect(matchStatus).toBeVisible();
  const matchStatusText = await matchStatus.textContent();
  console.log(`[white_text] extracted-text-match-status: ${matchStatusText}`);
  expect(matchStatusText).toMatch(/yes/i);

  // Visual Diff tab: overall changed-pixel ratio must be at/under threshold(white_text)=1e-5.
  await page.getByTestId("tab-visual-diff").click();
  const ratioText = await page.getByTestId("visual-diff-overall-ratio").textContent();
  console.log(`[white_text] visual-diff overall ratio: ${ratioText}`);
  const overallBadgeAfterDiff = await page.getByTestId("overall-badge").textContent();
  expect(overallBadgeAfterDiff).not.toBe("FAIL");

  await screenshotEachValidationTab(page, "white-text");

  // Downloads: output PDF, private manifest, validation report — filenames
  // per DoD item 12 / plan acceptance criteria (<stem>.injected.pdf etc).
  const [outputDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-output-button").click(),
  ]);
  expect(outputDownload.suggestedFilename()).toBe("five-page-text.injected.pdf");
  const outputPath = path.join(DOWNLOAD_DIR, outputDownload.suggestedFilename());
  await outputDownload.saveAs(outputPath);
  const outputBytes = await fs.readFile(outputPath);
  expect(outputBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  expect(reportDownload.suggestedFilename()).toBe("five-page-text.validation-report.json");
  const reportPath = path.join(DOWNLOAD_DIR, reportDownload.suggestedFilename());
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  expect(report.source.pageCount).toBe(5);
  expect(report.output.pageCount).toBe(5);
  expect(report.serverValidation.geometry.passed).toBe(true);
  expect(report.serverValidation.textExtraction.targetPageMatch).toBe(true);

  await page.getByTestId("tab-private-manifest").click();
  await expect(page.getByTestId("private-manifest-warning")).toBeVisible();
  const [manifestDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-private-manifest-button").click(),
  ]);
  expect(manifestDownload.suggestedFilename()).toBe("five-page-text.private-manifest.json");
  const manifestPath = path.join(DOWNLOAD_DIR, manifestDownload.suggestedFilename());
  await manifestDownload.saveAs(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  // DoD item 12 evidence: manifest contains the instruction + 3 sha256 hashes.
  expect(manifest.prompt.instruction).toBe(DOD_INSTRUCTION);
  expect(manifest.sourceFile.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.outputFile.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.prompt.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.warning).toContain("Do not distribute to students");

  // Capture jobId/token from sessionStorage-persisted job credentials before deleting
  // (apps/web/src/lib/job-storage.ts — `pdf-injection.jobId` / `pdf-injection.accessToken`).
  const { jobId, accessToken } = await readJobCredentials(page);

  // DoD item 15: delete job -> confirm dialog -> all artifacts + SQLite record removed.
  await page.getByTestId("delete-job-button").click();
  await expect(page.getByTestId("delete-job-dialog")).toBeVisible();
  await page.getByTestId("delete-job-confirm-button").click();
  await expect(page.getByTestId("delete-job-dialog")).toBeHidden();
  // onDeleted() resets the wizard back to step 1 (Upload).
  await expect(page.getByTestId("upload-drop-zone")).toBeVisible();

  const afterDelete = await request.get(`${API_BASE}/api/v1/jobs/${jobId}`, {
    headers: { "X-Job-Token": accessToken },
  });
  expect(afterDelete.status()).toBe(404);
});

/**
 * PRD §22.4 + §29 item 13-14: the same generate/validate flow under
 * render_mode_3, asserting the extraction result is explicitly recorded as
 * either matched or not-matched (never silently omitted) and that page
 * geometry is preserved.
 */
test("render_mode_3: generate, validate, extraction result explicitly recorded", async ({
  page,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  await selectRadixOption(page, "injection-mode-select", "Render mode 3 (non-rendering)");
  await continueToGenerateAndSubmit(page);

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[render_mode_3] overall status: ${overall}`);
  // render_mode_3 is PASS_WITH_WARNINGS when hiddenTextExtracted is false per
  // the contract's overall-computation table, and PASS when it happens to be
  // true — either is a legitimate, recorded outcome, never FAIL for this
  // reason alone (FAIL would indicate a genuine geometry/render regression).
  expect(["PASS", "PASS_WITH_WARNINGS"]).toContain(overall);

  await page.getByTestId("tab-extracted-text").click();
  const matchStatusText = await page.getByTestId("extracted-text-match-status").textContent();
  console.log(`[render_mode_3] extracted-text-match-status: ${matchStatusText}`);
  // "explicitly recorded" = the UI shows a definite yes/no, not a blank/loading state.
  expect(matchStatusText).toMatch(/(yes|no)/i);

  await screenshotEachValidationTab(page, "render-mode-3");

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(DOWNLOAD_DIR, `render-mode-3-${reportDownload.suggestedFilename()}`);
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  const extraction = report.serverValidation.textExtraction;
  console.log(
    `[render_mode_3] server-side extraction: targetPageMatch=${extraction.targetPageMatch} anyPageMatch=${extraction.anyPageMatch}`,
  );
  expect(typeof extraction.targetPageMatch).toBe("boolean");

  // Geometry preserved (DoD item 9, re-asserted for the render_mode_3 condition per item 13).
  expect(report.source.pageCount).toBe(5);
  expect(report.output.pageCount).toBe(5);
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);
  for (let i = 0; i < report.output.pages.length; i++) {
    expect(report.output.pages[i].mediaBox).toEqual(report.source.pages[i].mediaBox);
    expect(report.output.pages[i].rotation).toBe(report.source.pages[i].rotation);
  }

  // Clean up this job too.
  const { jobId, accessToken } = await readJobCredentials(page);
  await page.getByTestId("delete-job-button").click();
  await page.getByTestId("delete-job-confirm-button").click();
  await expect(page.getByTestId("delete-job-dialog")).toBeHidden();

  const response = await page.request.get(`${API_BASE}/api/v1/jobs/${jobId}`, {
    headers: { "X-Job-Token": accessToken },
  });
  expect(response.status()).toBe(404);
});
