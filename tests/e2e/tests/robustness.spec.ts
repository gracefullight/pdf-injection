import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  continueToGenerateAndSubmit,
  deleteJobAndConfirm,
  fillInstructionAndSignals,
  ROUND2_SCREENSHOT_DIR,
  uploadFixtureAndContinue,
  waitForOverallLeavesNotTested,
  waitForRunTerminal,
  writeTinyPngFixture,
} from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

// Contains the job's expected signals (methodology_label "Method C", ordered_terms
// ["robustness", "limitations"]) so the human_edit transform's before/after survival is
// meaningful rather than trivially "never matched to begin with".
const CUSTOM_TEXTS = [
  "Following Method C methodology, I discuss robustness before limitations in this response.",
  "This answer applies Method C throughout and covers robustness prior to limitations.",
];

const SCREENSHOT_FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  ".tmp",
  "screenshot-ocr-fixture.png",
);

/**
 * PRD §26 Phase 5 — robustness: `print_to_pdf` (requires canvasAvailable) + `human_edit` text
 * transform on custom texts, plus the separate screenshot-OCR upload panel. Skips OCR-specific
 * assertions gracefully (without failing) if `health.ocrAvailable` is false on this machine.
 */
test("robustness: print_to_pdf + human_edit run, artifact download, screenshot OCR", async ({
  page,
  request,
}) => {
  const health = await (await request.get("http://localhost:3001/api/v1/health")).json();
  console.log(`[robustness] health.features: ${JSON.stringify(health.features)}`);

  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  await continueToGenerateAndSubmit(page);
  await waitForOverallLeavesNotTested(page);

  await page.getByTestId("tab-robustness").click();
  await expect(page.getByTestId("robustness-tab")).toBeVisible();
  await expect(page.getByTestId("robustness-run-form")).toBeVisible();

  if (health.features.canvasAvailable) {
    await page.getByTestId("robustness-pdf-transform-print_to_pdf").click();
  } else {
    console.log("[robustness] canvasAvailable=false — skipping print_to_pdf selection.");
  }

  await page.getByTestId("robustness-text-transform-human_edit").click();
  // sourceKind defaults to "custom"; provider defaults to "mock" (no acknowledgement needed).
  await page.getByTestId("robustness-custom-texts-textarea").fill(CUSTOM_TEXTS.join("\n"));
  await page.getByTestId("robustness-seed-input").fill("e2e-robustness-seed");

  await expect(page.getByTestId("robustness-run-button")).toBeEnabled();
  await page.getByTestId("robustness-run-button").click();

  await expect(page.getByTestId("robustness-results")).toBeVisible({ timeout: 15_000 });
  const finalStatus = await waitForRunTerminal(page, "robustness-run-status-badge", 60_000);
  console.log(`[robustness] run status: ${finalStatus}`);
  expect(finalStatus).toBe("completed");

  await expect(page.getByTestId("robustness-summary")).not.toBeEmpty();

  if (health.features.canvasAvailable) {
    const pdfRow = page.getByTestId("robustness-pdf-row-print_to_pdf");
    await expect(pdfRow).toBeVisible();
    const rowText = await pdfRow.textContent();
    console.log(`[robustness] print_to_pdf row: ${rowText}`);

    const [artifactDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("robustness-pdf-download-print_to_pdf").click(),
    ]);
    const artifactPath = path.join(
      import.meta.dirname,
      "..",
      ".tmp",
      "downloads",
      artifactDownload.suggestedFilename(),
    );
    await artifactDownload.saveAs(artifactPath);
    const artifactBytes = await fs.readFile(artifactPath);
    expect(artifactBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }

  const textRow = page.getByTestId("robustness-text-row-human_edit");
  await expect(textRow).toBeVisible();
  const textRowContent = await textRow.textContent();
  console.log(`[robustness] human_edit text row: ${textRowContent}`);

  await page.getByTestId("robustness-text-samples-toggle-human_edit").click();
  const samples = page.getByTestId("robustness-text-samples-human_edit");
  await expect(samples).toBeVisible();
  const samplesText = await samples.textContent();
  console.log(`[robustness] human_edit samples: ${samplesText}`);
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "robustness-results.png"),
    fullPage: true,
  });

  // Screenshot OCR panel (separate from the run above) — gated on health.features.ocrAvailable
  // via FeatureGate; skip gracefully (not a failure) when unavailable on this machine.
  if (health.features.ocrAvailable) {
    await writeTinyPngFixture(SCREENSHOT_FIXTURE_PATH);
    await page.getByTestId("screenshot-ocr-file-input").setInputFiles(SCREENSHOT_FIXTURE_PATH);
    await expect(page.getByTestId("screenshot-ocr-result")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("screenshot-ocr-error")).not.toBeVisible();
    const ocrCardText = await page.getByTestId("screenshot-ocr-result").textContent();
    console.log(`[robustness] screenshot-ocr result: ${ocrCardText}`);
  } else {
    console.log("[robustness] ocrAvailable=false — skipping screenshot OCR assertions.");
    await expect(page.getByTestId("feature-gate-ocrAvailable")).toBeVisible();
  }

  await page.locator('[data-testid^="robustness-run-delete-"]').first().click();
  await expect(page.getByTestId("robustness-run-delete-dialog")).toBeVisible();
  await page.getByTestId("robustness-run-delete-confirm-button").click();
  await expect(page.getByTestId("robustness-runs-empty")).toBeVisible({ timeout: 10_000 });

  await deleteJobAndConfirm(page);
});
