import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  continueToGenerateAndSubmit,
  DOD_INSTRUCTION,
  DOWNLOAD_DIR,
  deleteJobAndConfirm,
  ROUND2_SCREENSHOT_DIR,
  selectRadixOption,
  waitForOverallLeavesNotTested,
  waitForRunTerminal,
} from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

// Same job-level expected signals as fillInstructionAndSignals's DOD_INSTRUCTION (methodology_label
// "Method C" + ordered_terms ["robustness", "limitations"]) — kept here in full because this spec
// uses a different upload fixture than the shared helper.
const ONE_PAGE_FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "fixtures",
  "one-page-text.pdf",
);

const CUSTOM_TEXTS = [
  "Following Method C methodology, I discuss robustness before limitations in this response.",
  "This answer applies Method C throughout and covers robustness prior to limitations.",
];

/**
 * PRD §26 Phase 5 — cycle 2: E2E coverage for the two bullets flagged as unit-only in cycle 1
 * (`ocr_regeneration` and `paraphrase`). Uses `one-page-text.pdf` (1 page) specifically to keep
 * tesseract.js OCR runtime bounded.
 */
test("robustness: ocr_regeneration + paraphrase (mock), artifact + samples", async ({
  page,
  request,
}) => {
  const health = await (await request.get("http://localhost:3001/api/v1/health")).json();
  console.log(`[robustness_ocr_paraphrase] health.features: ${JSON.stringify(health.features)}`);

  await page.goto("/");
  await page.getByTestId("upload-file-input").setInputFiles(ONE_PAGE_FIXTURE_PATH);
  await expect(page.getByTestId("upload-summary-card")).toBeVisible();
  await page.getByTestId("upload-continue-button").click();
  await expect(page.getByTestId("instruction-textarea")).toBeVisible();

  await page.getByTestId("instruction-textarea").fill(DOD_INSTRUCTION);
  await selectRadixOption(page, "signal-type-select", "Methodology label");
  await page.getByTestId("signal-add-button").click();
  await expect(page.getByTestId("signal-row-0")).toBeVisible();
  await page.locator("#signal-0-value").fill("Method C");
  await selectRadixOption(page, "signal-type-select", "Ordered terms");
  await page.getByTestId("signal-add-button").click();
  await expect(page.getByTestId("signal-row-1")).toBeVisible();
  await page.locator("#signal-1-values").fill("robustness, limitations");

  await continueToGenerateAndSubmit(page);
  await waitForOverallLeavesNotTested(page);

  await page.getByTestId("tab-robustness").click();
  await expect(page.getByTestId("robustness-run-form")).toBeVisible();

  // ocr_regeneration requires canvasAvailable && ocrAvailable (see robustness-helpers.ts's
  // pdfTransformAvailability) — both true per the health check above on this machine; skip
  // gracefully (documented, not silently) if either is unavailable elsewhere.
  const ocrTransformAvailable = health.features.canvasAvailable && health.features.ocrAvailable;
  if (ocrTransformAvailable) {
    await page.getByTestId("robustness-pdf-transform-ocr_regeneration").click();
  } else {
    console.log(
      "[robustness_ocr_paraphrase] canvas/ocr unavailable — skipping ocr_regeneration selection.",
    );
  }

  await page.getByTestId("robustness-text-transform-paraphrase").click();
  // provider defaults to "mock" (deterministic seeded synonym table + clause reorder — no
  // acknowledgement needed since paraphrase mock never leaves this machine).
  await page.getByTestId("robustness-custom-texts-textarea").fill(CUSTOM_TEXTS.join("\n"));
  await page.getByTestId("robustness-seed-input").fill("e2e-ocr-paraphrase-seed");

  await expect(page.getByTestId("robustness-run-button")).toBeEnabled();
  await page.getByTestId("robustness-run-button").click();

  await expect(page.getByTestId("robustness-results")).toBeVisible({ timeout: 15_000 });
  // tesseract.js worker startup + a single-page OCR pass can take longer than the default poll
  // window — generous but still bounded since the fixture is only 1 page.
  const finalStatus = await waitForRunTerminal(page, "robustness-run-status-badge", 90_000);
  console.log(`[robustness_ocr_paraphrase] run status: ${finalStatus}`);
  expect(finalStatus).toBe("completed");

  if (ocrTransformAvailable) {
    const ocrRow = page.getByTestId("robustness-pdf-row-ocr_regeneration");
    await expect(ocrRow).toBeVisible();
    const ocrRowText = await ocrRow.textContent();
    console.log(`[robustness_ocr_paraphrase] ocr_regeneration row: ${ocrRowText}`);
    expect(ocrRowText).toContain("Available");

    const [artifactDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("robustness-pdf-download-ocr_regeneration").click(),
    ]);
    const artifactPath = path.join(DOWNLOAD_DIR, artifactDownload.suggestedFilename());
    await artifactDownload.saveAs(artifactPath);
    const artifactBytes = await fs.readFile(artifactPath);
    expect(artifactBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  }

  const paraphraseRow = page.getByTestId("robustness-text-row-paraphrase");
  await expect(paraphraseRow).toBeVisible();
  // Table columns: Transform, Provider, Availability, Survival rate, Samples.
  const survivalRateText = (await paraphraseRow.locator("td").nth(3).textContent())?.trim() ?? "";
  console.log(`[robustness_ocr_paraphrase] paraphrase survival rate: ${survivalRateText}`);
  expect(survivalRateText).toMatch(/^\d+(\.\d+)?%$/);
  expect(Number.isNaN(Number.parseFloat(survivalRateText))).toBe(false);

  await page.getByTestId("robustness-text-samples-toggle-paraphrase").click();
  const samples = page.getByTestId("robustness-text-samples-paraphrase");
  await expect(samples).toBeVisible();
  const samplesText = await samples.textContent();
  console.log(`[robustness_ocr_paraphrase] paraphrase samples: ${samplesText}`);
  expect(samplesText?.trim().length ?? 0).toBeGreaterThan(0);

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "robustness-ocr-paraphrase-results.png"),
    fullPage: true,
  });

  await page.locator('[data-testid^="robustness-run-delete-"]').first().click();
  await expect(page.getByTestId("robustness-run-delete-dialog")).toBeVisible();
  await page.getByTestId("robustness-run-delete-confirm-button").click();
  await expect(page.getByTestId("robustness-runs-empty")).toBeVisible({ timeout: 10_000 });

  await deleteJobAndConfirm(page);
});
