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
 * PRD §26 Phase 3/5 — `unicode_tags` (experimental research channel) end-to-end.
 *
 * pdfjs-dist unconditionally filters Unicode General_Category=Cf (Format) characters, and the
 * entire Unicode Tags block (U+E0000-U+E007F) is Cf — so this app's own PDF.js-based extraction
 * (both server-side `extractText()` and the browser's own client-side extraction that
 * `ExtractedTextTab` renders from) can NEVER surface the tag-encoded payload, deterministically,
 * not just uncertainly. The payload's actual presence is instead verified server-side via a
 * public-pdf-lib-API CMap read-back (packages/pdf-engine's `readUnicodeTagsPayload`) and surfaced
 * as a `serverValidation.warnings` entry, `code: "UNICODE_TAGS_NOT_EXTRACTABLE"`. This spec
 * verifies: the mode is selectable (gated by the same `koPayload` server feature flag as Korean
 * payload, since both need the embedded font), the job completes with `overall:
 * PASS_WITH_WARNINGS` (never plain PASS — hiddenTextExtracted is always false for this mode —
 * and never FAIL), the new warning surfaces through the existing generic
 * `overall-explanation`/warnings mechanism with zero new UI plumbing, the Extracted Text tab
 * shows the static informational notice (not a decoded preview, which is unsatisfiable by
 * design), and the Model Test tab's condition checklist includes it.
 */
test("unicode_tags mode: generate, PASS_WITH_WARNINGS, warning surfaces, extracted-text notice, model-test condition", async ({
  page,
  request,
}) => {
  const health = await (await request.get(`${API_BASE_URL}/api/v1/health`)).json();
  const koPayloadAvailable = Boolean(health.features?.koPayload);
  console.log(`[unicode_tags] health.features.koPayload: ${koPayloadAvailable}`);

  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);

  // unicode_tags reuses the same embedded-font pipeline (embedKoreanFont) as payloadLanguage
  // "ko", so its mode option is gated by the identical `koPayloadAvailable` server feature flag —
  // verify the option's disabled state matches the live health response before deciding whether
  // the rest of this spec can exercise the full generate flow.
  await page.getByTestId("injection-mode-select").click();
  const modeOption = page.getByTestId("injection-mode-option-unicode-tags");
  await expect(modeOption).toBeVisible();
  // Radix's Select.Item only ever renders `aria-disabled="true"` (set to `disabled || void 0`);
  // when enabled the attribute is omitted entirely rather than set to `"false"` — so absence, not
  // an explicit `"false"` value, is the "enabled" signal here.
  if (koPayloadAvailable) {
    await expect(modeOption).not.toHaveAttribute("aria-disabled", "true");
  } else {
    await expect(modeOption).toHaveAttribute("aria-disabled", "true");
  }

  if (!koPayloadAvailable) {
    // Same font dependency as Korean payload; when unavailable on this server, the option is
    // disabled and unselectable — nothing further to exercise (mirrors this codebase's existing
    // graceful-skip precedent for other environment-dependent features, e.g. robustness.spec.ts's
    // OCR-availability check).
    await page.keyboard.press("Escape");
    return;
  }

  await modeOption.click();
  await expect(page.getByTestId("injection-mode-description")).toContainText("Unicode Tag");
  await expect(page.getByTestId("injection-mode-unicode-tags-caveat")).toBeVisible();

  await expect(page.getByTestId("instruction-continue-button")).toBeEnabled();
  await page.getByTestId("instruction-continue-button").click();
  await expect(page.getByTestId("generate-button")).toBeVisible();
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("validation-screen")).toBeVisible({ timeout: 30_000 });

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[unicode_tags] overall status: ${overall}`);
  // hiddenTextExtracted is deterministically false for this mode (pdfjs's Cf-category filtering),
  // so computeOverall()'s render_mode_3-style treatment always yields PASS_WITH_WARNINGS here —
  // never plain PASS, and never FAIL (extraction alone never fails this mode).
  expect(overall).toBe("PASS_WITH_WARNINGS");

  const explanationText = await page.getByTestId("overall-explanation").textContent();
  console.log(`[unicode_tags] overall-explanation: ${explanationText}`);
  // The existing generic serverValidation.warnings-driven mechanism (validation-screen.tsx's
  // summarizeOverallReasons) surfaces both the hardcoded hiddenTextExtracted:false reason AND the
  // new UNICODE_TAGS_NOT_EXTRACTABLE warning's message with zero new UI component — this is the
  // load-bearing proof of that.
  expect(explanationText).toContain("hidden text not extracted server-side");
  expect(explanationText).toMatch(/PDF\.js-based text extraction/);

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "unicode-tags-validation-screen.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-extracted-text").click();
  await expect(page.getByTestId("extracted-text-tab")).toBeVisible();
  // The static informational notice (task-4's revision-3 rework) — NOT a decoded-preview claim,
  // which is unsatisfiable by design (the browser's own pdfjs extraction has the identical
  // Cf-category filtering as the server).
  await expect(page.getByTestId("extracted-text-unicode-tags-note")).toBeVisible();
  await expect(page.getByTestId("extracted-text-unicode-tags-note")).toContainText(
    "not visible to PDF.js text extraction",
  );
  // No decoded/preview claim is rendered for this mode: pdfjs filters the tag characters, so
  // the app shows the static note above instead of promising a decode it can never perform.
  await expect(page.getByTestId("extracted-text-unicode-tags-decoded")).toHaveCount(0);
  await expect(page.getByTestId("extracted-text-unicode-tags-preview")).toHaveCount(0);
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "unicode-tags-extracted-text.png"),
    fullPage: true,
  });

  await page.getByTestId("tab-model-test").click();
  await expect(page.getByTestId("model-test-tab")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-unicode_tags")).toBeVisible();
  await expect(page.getByTestId("model-test-condition-unicode_tags")).toBeChecked();

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(DOWNLOAD_DIR, `unicode-tags-${reportDownload.suggestedFilename()}`);
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  expect(report.injection.mode).toBe("unicode_tags");
  expect(report.summary.hiddenTextExtracted).toBe(false);
  expect(report.summary.overall).toBe("PASS_WITH_WARNINGS");
  // Geometry / page count untouched (invisible text-rendering mode, identical geometry contract
  // to render_mode_3).
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);

  const serverWarnings = report.serverValidation.warnings as Array<{
    code: string;
    message: string;
  }>;
  console.log(`[unicode_tags] serverValidation.warnings: ${JSON.stringify(serverWarnings)}`);
  const unicodeTagsWarning = serverWarnings.find((w) => w.code === "UNICODE_TAGS_NOT_EXTRACTABLE");
  expect(unicodeTagsWarning).toBeDefined();
  expect(unicodeTagsWarning?.message).toMatch(/PDF\.js-based text extraction/);

  await deleteJobAndConfirm(page);
});
