import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  DOD_INSTRUCTION,
  DOWNLOAD_DIR,
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

/**
 * PRD §26 Phase 3/5 — `xmp_only` (research control) end-to-end: the payload lives only in the
 * catalog `/Metadata` XMP packet, page content streams are untouched. Verifies: overall is not
 * FAIL, `serverValidation.metadata.payloadFound` / `summary.metadataPayloadPresent` are true, and
 * both the validation report and the private manifest record `injection.mode: "xmp_only"`.
 */
test("xmp_only mode: generate, metadata payload present, overall not FAIL", async ({ page }) => {
  await uploadFixtureAndContinue(page);
  await fillInstructionAndSignals(page);

  await selectRadixOption(page, "injection-mode-select", "XMP metadata only (research control)");
  await expect(page.getByTestId("injection-mode-xmp-only-caveat")).toBeVisible();

  await expect(page.getByTestId("instruction-continue-button")).toBeEnabled();
  await page.getByTestId("instruction-continue-button").click();
  await expect(page.getByTestId("generate-button")).toBeVisible();
  await page.getByTestId("generate-button").click();
  await expect(page.getByTestId("validation-screen")).toBeVisible({ timeout: 30_000 });

  const overall = await waitForOverallLeavesNotTested(page);
  console.log(`[xmp_only] overall status: ${overall}`);
  // "Research control — payload only in XMP metadata" is a legitimate positive outcome for this
  // mode; the contract's overall-computation table only fails xmp_only when the metadata payload
  // itself is missing (checked directly from the report below), never on the (by-design) absence
  // of a content-stream match.
  expect(overall).not.toBe("FAIL");

  // PDF Structure tab is the closest UI surface to this report section (no dedicated UI field
  // renders metadataPayloadPresent — see the report assertions below for the authoritative check).
  await page.getByTestId("tab-pdf-structure").click();
  await expect(page.getByTestId("pdf-structure-tab")).toBeVisible();
  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "xmp-only-pdf-structure.png"),
    fullPage: true,
  });

  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-report-button").click(),
  ]);
  const reportPath = path.join(DOWNLOAD_DIR, `xmp-only-${reportDownload.suggestedFilename()}`);
  await reportDownload.saveAs(reportPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));

  console.log(
    `[xmp_only] serverValidation.metadata: ${JSON.stringify(report.serverValidation.metadata)}`,
  );
  expect(report.injection.mode).toBe("xmp_only");
  expect(report.serverValidation.metadata.payloadFound).toBe(true);
  expect(report.serverValidation.metadata.xmpPresent).toBe(true);
  expect(report.summary.metadataPayloadPresent).toBe(true);
  // Geometry / page count untouched (no content-stream change per the injection mode's contract).
  expect(report.serverValidation.pageCount.passed).toBe(true);
  expect(report.serverValidation.geometry.passed).toBe(true);

  await page.getByTestId("tab-private-manifest").click();
  await expect(page.getByTestId("private-manifest-warning")).toBeVisible();
  const [manifestDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-private-manifest-button").click(),
  ]);
  const manifestPath = path.join(DOWNLOAD_DIR, `xmp-only-${manifestDownload.suggestedFilename()}`);
  await manifestDownload.saveAs(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  expect(manifest.injection.mode).toBe("xmp_only");
  expect(manifest.prompt.instruction).toBe(DOD_INSTRUCTION);

  await deleteJobAndConfirm(page);
});
