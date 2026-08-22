import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  continueToGenerateAndSubmit,
  DOWNLOAD_DIR,
  deleteJobAndConfirm,
  fillInstructionAndSignals,
  ROUND2_SCREENSHOT_DIR,
  uploadFixtureAndContinue,
  waitForRunTerminal,
} from "./helpers";

const CONDITIONS = [
  "original",
  "white_text",
  "render_mode_3",
  "visible_positive_control",
  "xmp_only",
  "unicode_tags",
];

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
});

/**
 * PRD §26 Phase 3 — provider benchmark, mock provider only (no keys/network in this suite):
 * run -> poll -> per-condition aggregates -> smoke-test gate card (§23.2 gate display) ->
 * export JSON -> delete run.
 */
test("model test: mock provider, all conditions, repeats 2, aggregates + gate + export", async ({
  page,
}) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);
  await continueToGenerateAndSubmit(page);

  await page.getByTestId("tab-model-test").click();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();
  await expect(page.getByTestId("model-test-privacy-warning")).toBeVisible();
  await expect(page.getByTestId("model-test-privacy-warning")).toContainText(
    "Mock and Ollama (local) never leave this machine",
  );

  // No standalone acknowledgement checkbox anymore (contract addendum §6) — consent is implicit
  // in selecting a non-local provider, and the informational alert above stays visible instead.
  await expect(page.getByTestId("model-test-acknowledge-checkbox")).toHaveCount(0);

  // Ollama isn't running on this CI/dev machine, so `health.features.ollama.available` is
  // false: the row is disabled with a hint naming the base URL, and the default provider
  // selection falls back to "mock" rather than upgrading to "ollama".
  await expect(page.getByTestId("model-test-provider-ollama")).toBeDisabled();
  await expect(page.getByTestId("model-test-provider-ollama-reason")).toContainText(
    "Ollama not detected on",
  );
  await expect(page.getByTestId("model-test-provider-ollama-reason")).toContainText(
    "start Ollama to use local models",
  );

  // Defaults already match what's needed: provider "mock" checked (ollama unavailable), all 6
  // conditions checked (ALL_BENCHMARK_CONDITIONS) — only repeats needs bumping to 2.
  await expect(page.getByTestId("model-test-provider-mock")).toBeChecked();
  for (const condition of CONDITIONS) {
    await expect(page.getByTestId(`model-test-condition-${condition}`)).toBeChecked();
  }
  await page.getByTestId("model-test-repeats-input").fill("2");

  await page.getByTestId("model-test-run-button").click();

  // createModelTestRun's onSuccess auto-selects the new run, so results render without an
  // explicit row click.
  await expect(page.getByTestId("model-test-results")).toBeVisible({ timeout: 15_000 });
  const finalStatus = await waitForRunTerminal(page, "model-test-run-status-badge");
  console.log(`[model_test] run status: ${finalStatus}`);
  expect(finalStatus).toBe("completed");

  await expect(page.getByTestId("model-test-gate-card")).toBeVisible();
  const interpretationText = await page.getByTestId("model-test-interpretation").textContent();
  console.log(`[model_test] interpretation: ${interpretationText}`);
  expect(interpretationText?.trim().length ?? 0).toBeGreaterThan(0);

  for (const condition of CONDITIONS) {
    const row = page.getByTestId(`model-test-aggregate-row-mock-${condition}`);
    await expect(row).toBeVisible();
    // Table columns: Provider, Condition, n, All-signal rate, Any-signal rate, Δ, Disclosure
    // rate, Refusal rate, Mean latency — n (3rd cell) = repeats (2), one provider selected.
    await expect(row.locator("td").nth(2)).toHaveText("2");
  }
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "model-test-results.png"),
    fullPage: true,
  });

  // C-01 regression (r11 review): Eden Treaty revives `result.executedAt` (typed `string`) into
  // a real `Date` object at runtime — rendering it raw used to throw "Objects are not valid as a
  // React child" with no error boundary anywhere in the tree, blanking the whole app on this one
  // click. Expanding a result must not crash, and the rest of the page must stay usable after.
  await page.getByTestId("model-test-result-toggle-0").click();
  await expect(page.getByTestId("model-test-result-detail-0")).toBeVisible();
  await expect(page.getByTestId("model-test-result-detail-0")).toContainText("Executed at:");
  await expect(page.getByTestId("error-boundary-fallback")).not.toBeVisible();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();

  const [exportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("model-test-export-json-button").click(),
  ]);
  expect(exportDownload.suggestedFilename()).toMatch(
    /^five-page-text\.model-tests\.[0-9a-f-]+\.json$/,
  );
  const exportPath = path.join(DOWNLOAD_DIR, exportDownload.suggestedFilename());
  await exportDownload.saveAs(exportPath);
  const exported = JSON.parse(await fs.readFile(exportPath, "utf8"));
  expect(exported.results.length).toBe(CONDITIONS.length * 2); // 6 conditions x 2 repeats
  expect(exported.smokeTestGate).toBeDefined();

  await page.locator('[data-testid^="model-test-run-delete-"]').first().click();
  await expect(page.getByTestId("model-test-run-delete-dialog")).toBeVisible();
  await page.getByTestId("model-test-run-delete-confirm-button").click();
  await expect(page.getByTestId("model-test-runs-empty")).toBeVisible({ timeout: 10_000 });

  await deleteJobAndConfirm(page);
});
