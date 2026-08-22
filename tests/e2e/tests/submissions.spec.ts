import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  continueToGenerateAndSubmit,
  deleteJobAndConfirm,
  fillInstructionAndSignals,
  ROUND2_SCREENSHOT_DIR,
  selectRadixOption,
  uploadFixtureAndContinue,
  waitForOverallLeavesNotTested,
} from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

const BASELINE_TEXTS = [
  "This report follows Method A and provides a general summary of the results without further elaboration.",
  "The analysis leverages Method B and offers a broad overview with no additional structural commentary.",
  "This document takes an alternative approach and does not reference any specific methodology label.",
];

// Contains both the job's expected signals: methodology_label "Method C" and ordered_terms
// ["robustness", "limitations"] (in that order) — see fillInstructionAndSignals / DOD_INSTRUCTION.
const CANDIDATE_TEXT =
  "In this response, I use Method C as my primary methodology. I will discuss robustness before covering limitations, as instructed.";

/**
 * PRD §26 Phase 4 — submission detection research (research mode): 3 baseline texts calibrate a
 * false-positive rate, 1 candidate text (crafted to contain both expected signals) produces an
 * analysis with headline/scores/calibration, the job-level statistics card shows Fisher/Holm
 * fields, and one submission can be deleted.
 */
test("submissions: 3 baseline + 1 candidate, analysis + calibration + statistics", async ({
  page,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  await continueToGenerateAndSubmit(page);
  // Human View (the default active tab) briefly overlays a "rendering and comparing…" state
  // while client-side validation runs, which can intercept clicks elsewhere on the page — wait
  // for it to settle before switching tabs (same as the round-1 workflow spec does).
  await waitForOverallLeavesNotTested(page);

  await page.getByTestId("tab-submissions").click();
  await expect(page.getByTestId("submissions-tab")).toBeVisible();
  await expect(page.getByTestId("submission-ack-notice")).toBeVisible();

  await page.getByTestId("submission-ack-checkbox").click();

  for (const baselineText of BASELINE_TEXTS) {
    await selectRadixOption(
      page,
      "submission-label-select",
      "Baseline (known-original, for calibration)",
    );
    await page.getByTestId("submission-text-input").fill(baselineText);
    await page.getByTestId("submission-submit-button").click();
    // handleSubmit() clears the textarea only on the success path (the error path leaves the
    // text in place and shows submission-form-error instead) — a solid, UI-level discriminator
    // to wait on before submitting the next baseline.
    await expect(page.getByTestId("submission-text-input")).toHaveValue("", { timeout: 15_000 });
  }

  await expect(page.getByTestId("submissions-list")).toContainText(
    `${BASELINE_TEXTS.length} of ${BASELINE_TEXTS.length}`,
  );

  await selectRadixOption(page, "submission-label-select", "Candidate (suspected injected)");
  await page.getByTestId("submission-text-input").fill(CANDIDATE_TEXT);
  await page.getByTestId("submission-submit-button").click();
  await expect(page.getByTestId("submission-text-input")).toHaveValue("", { timeout: 15_000 });

  const analysisCard = page.locator('[data-testid^="submission-analysis-"]');
  await expect(analysisCard).toBeVisible({ timeout: 15_000 });

  const headline = await page.getByTestId("submission-headline").textContent();
  console.log(`[submissions] candidate headline: ${headline}`);
  expect(headline).toMatch(
    /Hidden instruction signal matched|Behavioral canary detected|No consistent signal/,
  );

  for (const key of ["methodology", "lexical", "structural", "combined"]) {
    await expect(page.getByTestId(`submission-score-${key}`)).toBeVisible();
  }
  await expect(page.getByTestId("submission-interpretation-text")).not.toBeEmpty();
  await expect(page.getByTestId("submission-uncertainty")).not.toBeEmpty();

  const calibration = page.getByTestId("submission-calibration");
  await expect(calibration).toBeVisible();
  await expect(calibration).toContainText("3"); // baselineCount === 3

  const statisticsCard = page.getByTestId("submission-statistics-card");
  await expect(statisticsCard).toBeVisible({ timeout: 15_000 });
  await expect(statisticsCard).toContainText("Fisher exact p");
  await expect(statisticsCard).toContainText("Holm-adjusted p");
  await expect(page.getByTestId("submission-statistics-combined")).toBeVisible();
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "submissions-analysis.png"),
    fullPage: true,
  });

  const beforeCount = await page.locator('[data-testid^="submissions-row-"]').count();
  await page.locator('[data-testid^="submissions-delete-"]').first().click();
  await expect(page.getByTestId("submissions-delete-dialog")).toBeVisible();
  await page.getByTestId("submissions-delete-confirm-button").click();
  await expect(page.locator('[data-testid^="submissions-row-"]')).toHaveCount(beforeCount - 1, {
    timeout: 10_000,
  });

  await deleteJobAndConfirm(page);
});
