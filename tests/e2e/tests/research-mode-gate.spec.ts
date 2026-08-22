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
} from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

/**
 * PRD §26 Phase 4/5 gating — negative case: with `PDFI_RESEARCH_MODE` off (simulated here via
 * request interception on `GET /api/v1/health`, since flipping the env var for the whole suite
 * would also gate the Submissions/Robustness specs above), the Submissions and Robustness tabs
 * must show the gate message naming the exact env var to enable them, instead of silently
 * hiding the tab or rendering an empty/broken screen.
 */
test("research mode off: Submissions/Robustness tabs show the PDFI_RESEARCH_MODE gate message", async ({
  page,
}) => {
  await page.route("**/api/v1/health", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.features.researchMode = false;
    await route.fulfill({ response, json: body });
  });

  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  await continueToGenerateAndSubmit(page);
  await waitForOverallLeavesNotTested(page);

  await page.getByTestId("tab-submissions").click();
  const submissionsGate = page.getByTestId("feature-gate-researchMode");
  await expect(submissionsGate).toBeVisible();
  await expect(submissionsGate).toContainText("PDFI_RESEARCH_MODE=true");
  await expect(page.getByTestId("submissions-tab")).toHaveCount(0);
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "research-mode-gate-submissions.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-robustness").click();
  // Unlike SubmissionsTab (the FeatureGate wraps the whole panel), RobustnessTab's own
  // heading/description render unconditionally — only the form/results/screenshot panel below
  // it are gated — so robustness-tab itself stays visible while its inner controls disappear.
  await expect(page.getByTestId("robustness-tab")).toBeVisible();
  const robustnessGate = page.getByTestId("feature-gate-researchMode");
  await expect(robustnessGate).toBeVisible();
  await expect(robustnessGate).toContainText("PDFI_RESEARCH_MODE=true");
  await expect(page.getByTestId("robustness-run-form")).toHaveCount(0);
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "research-mode-gate-robustness.png"),
    fullPage: true,
  });

  await deleteJobAndConfirm(page);
});
