import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  API_BASE_URL,
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
 * Round-3 research/diagnostic probe — `image_only` end-to-end.
 *
 * Rasterizes the instruction to a PNG and stamps it on the page — no text object of any kind is
 * written, so `hiddenTextExtracted` is deterministically false (a stronger, structural guarantee
 * than the other three probe modes: there is no text-extractable channel here at all, for ANY
 * text extractor, not just this app's PDF.js-based one). Deliberately visible, unlike every other
 * probe mode (`diffThreshold` is `Infinity`, same treatment as `visible_positive_control`) — this
 * is not a hiding technique, it exists to test whether a provider's ingestion has a vision path.
 * Needs `@napi-rs/canvas` server-side (surfaced via `health.features.canvasAvailable`, the same
 * gate `injection-settings-form.tsx` uses to disable the mode option) — verify the option's
 * disabled state matches the live health response before deciding whether the rest of this spec
 * can exercise the full generate flow, mirroring `unicode-tags.spec.ts`'s `koPayload` gate check.
 */
test("image_only mode: generate, PASS_WITH_WARNINGS, warning surfaces, extracted-text notice, model-test condition", async ({
  page,
  request,
}) => {
  const health = await (await request.get(`${API_BASE_URL}/api/v1/health`)).json();
  const canvasAvailable = Boolean(health.features?.canvasAvailable);
  console.log(`[image_only] health.features.canvasAvailable: ${canvasAvailable}`);

  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);

  await page.getByTestId("injection-mode-select").click();
  const modeOption = page.getByTestId("injection-mode-option-image-only");
  await expect(modeOption).toBeVisible();
  // Radix's Select.Item only ever renders `aria-disabled="true"` (set to `disabled || void 0`);
  // when enabled the attribute is omitted entirely rather than set to `"false"` — absence, not an
  // explicit `"false"` value, is the "enabled" signal here (same convention as unicode_tags).
  if (canvasAvailable) {
    await expect(modeOption).not.toHaveAttribute("aria-disabled", "true");
  } else {
    await expect(modeOption).toHaveAttribute("aria-disabled", "true");
  }

  if (!canvasAvailable) {
    // Same native-dependency gate as unicode_tags/koPayload: when @napi-rs/canvas isn't resolvable
    // on this server, the option is disabled and unselectable — nothing further to exercise
    // (mirrors this codebase's existing graceful-skip precedent, e.g. robustness.spec.ts's
    // OCR-availability check and unicode-tags.spec.ts's koPayload check).
    await page.keyboard.press("Escape");
    return;
  }

  await modeOption.click();
  await expect(page.getByTestId("injection-mode-description")).toContainText("rasterized");
  await expect(page.getByTestId("injection-mode-image-only-caveat")).toBeVisible();
  await expect(page.getByTestId("injection-mode-research-probe-badge")).toBeVisible();
  await expect(page.getByTestId("injection-mode-visible-badge")).toBeVisible();

  await expect(page.getByTestId("instruction-continue-button")).toBeEnabled();
  await page.getByTestId("instruction-continue-button").click();
  await expect(page.getByTestId("generate-button")).toBeVisible();
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("validation-screen")).toBeVisible({ timeout: 30_000 });

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[image_only] overall status: ${overall}`);
  // hiddenTextExtracted is deterministically false (no text object exists at all) — always
  // PASS_WITH_WARNINGS, same computeOverall treatment as the other 3 probe modes, even though
  // diffThreshold is Infinity (deliberately visible) rather than near-zero.
  expect(overall).toBe("PASS_WITH_WARNINGS");

  const explanationText = await page.getByTestId("overall-explanation").textContent();
  console.log(`[image_only] overall-explanation: ${explanationText}`);
  expect(explanationText).toContain("hidden text not extracted server-side");

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "image-only-validation-screen.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-extracted-text").click();
  await expect(page.getByTestId("extracted-text-tab")).toBeVisible();
  const note = page.getByTestId("extracted-text-non-extractable-note-image-only");
  await expect(note).toBeVisible();
  await expect(note).toContainText("rasterized");

  await page.getByTestId("tab-model-test").click();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-image_only")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-image_only")).toBeChecked();
  await expect(page.getByTestId("model-test-condition-image_only-badge")).toBeVisible();

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(DOWNLOAD_DIR, `image-only-${reportDownload.suggestedFilename()}`);
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  expect(report.injection.mode).toBe("image_only");
  expect(report.summary.hiddenTextExtracted).toBe(false);
  expect(report.summary.overall).toBe("PASS_WITH_WARNINGS");
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);

  const serverWarnings = report.serverValidation.warnings as Array<{
    code: string;
    message: string;
  }>;
  console.log(`[image_only] serverValidation.warnings: ${JSON.stringify(serverWarnings)}`);
  const warning = serverWarnings.find((w) => w.code === "IMAGE_ONLY_NOT_TEXT_EXTRACTABLE");
  expect(warning).toBeDefined();
  expect(warning?.message).toMatch(/PDF\.js-based/);

  await deleteJobAndConfirm(page);
});
