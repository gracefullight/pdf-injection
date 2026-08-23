import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  DOWNLOAD_DIR,
  deleteJobAndConfirm,
  fillInstructionAndSignals,
  ROUND2_SCREENSHOT_DIR,
  uploadFixtureAndContinue,
  waitForOverallLeavesNotTested,
} from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

/**
 * Round-3 research/diagnostic probe — `freetext_annot` end-to-end.
 *
 * The payload is real, invisible (`3 Tr`) text drawn inside a FreeText annotation's own `/AP /N`
 * appearance stream — a channel this app's PDF.js-based `extractText()` never walks (it only
 * inspects a page's own content stream, not its annotations). So this mode's
 * `hiddenTextExtracted` is deterministically false, same shape as `unicode_tags`: overall is
 * always `PASS_WITH_WARNINGS` (never plain `PASS`, never `FAIL` on extraction alone), a
 * `FREETEXT_ANNOT_NOT_EXTRACTABLE` warning surfaces through the existing generic warnings
 * mechanism, the Extracted Text tab shows a static explanatory notice, and the Model Test
 * condition checklist includes it (checked by default, tagged "Research/diagnostic"). Unlike
 * `unicode_tags`, this mode needs no font-availability gate — no server feature flag disables it.
 */
test("freetext_annot mode: generate, PASS_WITH_WARNINGS, warning surfaces, extracted-text notice, model-test condition", async ({
  page,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);

  await page.getByTestId("injection-mode-select").click();
  const modeOption = page.getByTestId("injection-mode-option-freetext-annot");
  await expect(modeOption).toBeVisible();
  await modeOption.click();
  await expect(page.getByTestId("injection-mode-description")).toContainText("FreeText");
  await expect(page.getByTestId("injection-mode-freetext-annot-caveat")).toBeVisible();
  await expect(page.getByTestId("injection-mode-research-probe-badge")).toBeVisible();

  await expect(page.getByTestId("instruction-continue-button")).toBeEnabled();
  await page.getByTestId("instruction-continue-button").click();
  await expect(page.getByTestId("generate-button")).toBeVisible();
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("validation-screen")).toBeVisible({ timeout: 30_000 });

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[freetext_annot] overall status: ${overall}`);
  // hiddenTextExtracted is deterministically false for this mode (annotation appearance streams
  // are never walked by this project's extractText()) — always PASS_WITH_WARNINGS.
  expect(overall).toBe("PASS_WITH_WARNINGS");

  const explanationText = await page.getByTestId("overall-explanation").textContent();
  console.log(`[freetext_annot] overall-explanation: ${explanationText}`);
  expect(explanationText).toContain("hidden text not extracted server-side");

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "freetext-annot-validation-screen.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-extracted-text").click();
  await expect(page.getByTestId("extracted-text-tab")).toBeVisible();
  const note = page.getByTestId("extracted-text-non-extractable-note-freetext-annot");
  await expect(note).toBeVisible();
  await expect(note).toContainText("FreeText annotation");
  await expect(note).toContainText("pdftotext");

  await page.getByTestId("tab-model-test").click();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-freetext_annot")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-freetext_annot")).toBeChecked();
  await expect(page.getByTestId("model-test-condition-freetext_annot-badge")).toBeVisible();

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(
    DOWNLOAD_DIR,
    `freetext-annot-${reportDownload.suggestedFilename()}`,
  );
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  expect(report.injection.mode).toBe("freetext_annot");
  expect(report.summary.hiddenTextExtracted).toBe(false);
  expect(report.summary.overall).toBe("PASS_WITH_WARNINGS");
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);

  const serverWarnings = report.serverValidation.warnings as Array<{
    code: string;
    message: string;
  }>;
  console.log(`[freetext_annot] serverValidation.warnings: ${JSON.stringify(serverWarnings)}`);
  const warning = serverWarnings.find((w) => w.code === "FREETEXT_ANNOT_NOT_EXTRACTABLE");
  expect(warning).toBeDefined();
  expect(warning?.message).toMatch(/PDF\.js-based/);

  await deleteJobAndConfirm(page);
});
