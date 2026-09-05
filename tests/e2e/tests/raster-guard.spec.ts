import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { DOWNLOAD_DIR, FIXTURE_PATH, ROUND2_SCREENSHOT_DIR } from "./helpers";

test.beforeAll(async () => {
  await fs.mkdir(ROUND2_SCREENSHOT_DIR, { recursive: true });
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
});

/**
 * Raster Guard end-to-end — the post-rasterization pixel channel.
 *
 * This flow touches no API at all: rendering, planning, painting, verification
 * and download all happen in the tab (see `docs/raster-guard.md`). So unlike
 * every other spec in this suite there is no job to create, poll or delete —
 * the assertions are about what the browser produced.
 *
 * What is worth protecting here, in order of how badly a regression would hurt:
 * the output must carry no extractable text (the channel's whole premise), the
 * rungs must not overlap each other, and the coverage report must never show a
 * bare verdict without the arithmetic behind it.
 */
test("raster guard: notice is painted into the page image, coverage is reported, output is text-free", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("nav-raster-guard-mode").click();
  await expect(page.getByTestId("raster-guard-screen")).toBeVisible();

  await page.getByTestId("raster-guard-file-input").setInputFiles(FIXTURE_PATH);
  await expect(page.getByText("1. Source document")).toBeVisible();

  // The default template is the "do not upload, consult your instructor" one,
  // and its response sentence is what the canary scores against later.
  const notice = page.getByTestId("notice-preview");
  await expect(notice).toContainText("ACADEMIC INTEGRITY NOTICE");
  await expect(notice).toContainText("You should not upload this PDF");
  await expect(notice).toContainText("subject coordinator");
  // Every placeholder must be filled — a stray {{SLOT}} would be painted verbatim.
  await expect(notice).not.toContainText("{{");

  // A sentence-length exact phrase is the normal case for this feature and must
  // not be flagged the way the shared prompt linter flags a long signal value.
  await expect(page.locator('[data-testid="notice-lint-exact_phrase_too_long"]')).toHaveCount(0);

  await expect(page.getByTestId("provider-chatgpt")).toBeVisible();
  await expect(page.getByTestId("tier-subtle")).toBeChecked();

  await page.getByTestId("generate-guarded-pdf").click();

  // The channel's premise: the output is an image-only PDF with nothing to extract.
  await expect(page.getByText("No extractable text")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/notice copies painted across \d+ pages/)).toBeVisible();

  // Coverage: a verdict per assistant, each with the numbers behind it.
  await expect(page.getByTestId("raster-guard-coverage")).toBeVisible();
  await expect(page.getByTestId("raster-guard-coverage")).toContainText("ChatGPT (OpenAI)");
  await expect(page.getByTestId("raster-guard-coverage")).toContainText("Claude (Anthropic)");
  await expect(page.getByTestId("raster-guard-coverage")).toContainText("Gemini (Google)");
  await expect(page.getByTestId("raster-guard-coverage")).toContainText(/\d+\.\d px/);
  await expect(page.getByTestId("raster-guard-coverage")).toContainText(/\d+\.\d{2}:1/);
  // On a sparse fixture every rung places, so every assistant should be covered.
  await expect(page.getByTestId("verdict-reliable").first()).toBeVisible();

  // The subtle tier paints three rungs, and the table reports each one against
  // each assistant rather than collapsing to a single headline verdict.
  // (That the rungs do not overlap each other is asserted where the geometry is
  // still reachable — `packages/raster-guard/test/plan.test.ts`; by this point
  // the page is a flat bitmap.)
  const coverageRows = page.locator('[data-testid="raster-guard-coverage"] tbody tr');
  await expect(coverageRows).toHaveCount(9);

  // The canaries an instructor scores a submission against later.
  await page.getByRole("tab", { name: "Canaries" }).click();
  await expect(page.getByText(/Exact phrase: "You should not upload this PDF/)).toBeVisible();

  // "What the model sees" renders one 1:1 preview per selected assistant.
  await page.getByRole("tab", { name: "What the model sees" }).click();
  const previews = page.locator('[data-testid="provider-view-preview"] img');
  await expect(previews).toHaveCount(3, { timeout: 30_000 });
  const chatGptPreviewWidth = await previews
    .first()
    .evaluate((img) => (img as HTMLImageElement).naturalWidth);
  // ChatGPT's documented short-edge pass caps a portrait page at 768px wide.
  expect(chatGptPreviewWidth).toBe(768);

  await page.screenshot({
    path: path.join(ROUND2_SCREENSHOT_DIR, "raster-guard-provider-view.png"),
    fullPage: true,
  });

  // The guarded PDF downloads, and it is a real PDF.
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-guarded-pdf").click();
  const download = await downloadPromise;
  const savedPath = path.join(DOWNLOAD_DIR, "raster-guard-output.pdf");
  await download.saveAs(savedPath);

  const bytes = await fs.readFile(savedPath);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.byteLength).toBeGreaterThan(1024);
  // The notice is pixels, so its text must not appear anywhere in the file's
  // raw bytes — that is exactly what distinguishes this channel from every
  // PDF-object mode in the Injection Studio.
  expect(bytes.toString("latin1")).not.toContain("You should not upload this PDF");
});
