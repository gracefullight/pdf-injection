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
 * Round-3 research/diagnostic probe — `info_dict` end-to-end.
 *
 * The payload lives only in the classic `/Info` dictionary's Subject and Keywords fields —
 * never in any page's text or content stream. This app's PDF.js-based `extractText()` never
 * inspects document metadata at all, so `hiddenTextExtracted` is deterministically false: overall
 * is always `PASS_WITH_WARNINGS`, an `INFO_DICT_NOT_EXTRACTABLE` warning surfaces through the
 * existing generic warnings mechanism, the Extracted Text tab shows a static explanatory notice,
 * and the Model Test condition checklist includes it (checked by default, tagged
 * "Research/diagnostic"). Distinct from `xmp_only` (which carries a separate,
 * XMP-`/Metadata`-specific payload) — this mode's own document Title must survive untouched.
 */
test("info_dict mode: generate, PASS_WITH_WARNINGS, warning surfaces, extracted-text notice, model-test condition", async ({
  page,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);

  await page.getByTestId("injection-mode-select").click();
  const modeOption = page.getByTestId("injection-mode-option-info-dict");
  await expect(modeOption).toBeVisible();
  await modeOption.click();
  await expect(page.getByTestId("injection-mode-description")).toContainText("/Info");
  await expect(page.getByTestId("injection-mode-info-dict-caveat")).toBeVisible();
  await expect(page.getByTestId("injection-mode-research-probe-badge")).toBeVisible();

  await expect(page.getByTestId("instruction-continue-button")).toBeEnabled();
  await page.getByTestId("instruction-continue-button").click();
  await expect(page.getByTestId("generate-button")).toBeVisible();
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("validation-screen")).toBeVisible({ timeout: 30_000 });

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[info_dict] overall status: ${overall}`);
  expect(overall).toBe("PASS_WITH_WARNINGS");

  const explanationText = await page.getByTestId("overall-explanation").textContent();
  console.log(`[info_dict] overall-explanation: ${explanationText}`);
  expect(explanationText).toContain("hidden text not extracted server-side");

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "info-dict-validation-screen.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-extracted-text").click();
  await expect(page.getByTestId("extracted-text-tab")).toBeVisible();
  const note = page.getByTestId("extracted-text-non-extractable-note-info-dict");
  await expect(note).toBeVisible();
  await expect(note).toContainText("/Info");
  await expect(note).toContainText("pdfinfo");

  await page.getByTestId("tab-model-test").click();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-info_dict")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-info_dict")).toBeChecked();
  await expect(page.getByTestId("model-test-condition-info_dict-badge")).toBeVisible();

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(DOWNLOAD_DIR, `info-dict-${reportDownload.suggestedFilename()}`);
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  expect(report.injection.mode).toBe("info_dict");
  expect(report.summary.hiddenTextExtracted).toBe(false);
  expect(report.summary.overall).toBe("PASS_WITH_WARNINGS");
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);

  const serverWarnings = report.serverValidation.warnings as Array<{
    code: string;
    message: string;
  }>;
  console.log(`[info_dict] serverValidation.warnings: ${JSON.stringify(serverWarnings)}`);
  const warning = serverWarnings.find((w) => w.code === "INFO_DICT_NOT_EXTRACTABLE");
  expect(warning).toBeDefined();
  expect(warning?.message).toMatch(/PDF\.js-based/);

  await deleteJobAndConfirm(page);
});
