import type { ExpectedSignal } from "@pdf-injection/contracts";
import {
  buildGuardPlan,
  type GuardChannel,
  type GuardPlan,
  type PageLayout,
  type PageSize,
  type PlanWarning,
  type SalienceTier,
  type VisionProviderId,
} from "@pdf-injection/raster-guard";
import { PDFDocument } from "pdf-lib";
import {
  inkBoxesFromImageData,
  readPageLayout,
  sampleBackgroundHex,
} from "@/features/raster-guard/page-occupancy";
import { adaptStampContext, stampPageInstances } from "@/features/raster-guard/stamp-instances";
import { canvasToImageBytes } from "@/features/rasterizer/rasterize-pdf";
import { extractPageText, loadPdf, renderPageToCanvas } from "@/lib/pdfjs";

export interface BuildGuardedPdfOptions {
  noticeText: string;
  compactNoticeText: string;
  watermarkText: string;
  tier: SalienceTier;
  targetProviders: VisionProviderId[];
  channels?: GuardChannel[];
  scope?: "all" | "first";
  expectedSignals?: ExpectedSignal[];
  /** Pixels per point the pages are rendered at. 2 = 144 DPI. */
  scale?: number;
  imageFormat?: "image/png" | "image/jpeg";
  jpegQuality?: number;
  onProgress?: (progress: { current: number; total: number; percent: number }) => void;
  signal?: AbortSignal;
}

export interface BuildGuardedPdfResult {
  bytes: Uint8Array;
  pageCount: number;
  originalSizeBytes: number;
  guardedSizeBytes: number;
  scaleUsed: number;
  formatUsed: "image/png" | "image/jpeg";
  /** The merged plan actually painted, page by page. */
  plan: GuardPlan;
  /** Page sizes by 0-based index, for the coverage report. */
  pageSizes: Map<number, PageSize>;
  /** Paper colour sampled under the first painted instance — what the contrast check is measured against. */
  backgroundHex: string;
  /** Whether the output has no extractable text at all. Expected to be true. */
  isTextFree: boolean;
  totalExtractedCharacters: number;
}

/**
 * Renders every page, paints the notice into the bitmap, and rebuilds an
 * image-only PDF.
 *
 * The order matters and is the whole point: the notice is painted **after**
 * rasterization, into the pixels, so the output carries no text object for a
 * sanitizer to strip and no hidden-text channel for a metamorphic detector to
 * find. It is also why the notice cannot be removed by re-rasterizing — the
 * defense this repo ships in its own PDF Rasterizer screen — without also
 * destroying the page it is painted on.
 *
 * Planning runs per page inside the render loop rather than in a separate pass:
 * every planning input (page size, content boxes, provider floors) is
 * page-local, so a single pass gives the same plan a two-pass version would,
 * without rendering each page twice or holding every page bitmap in memory.
 */
export async function buildGuardedPdf(
  pdfBytes: Uint8Array,
  options: BuildGuardedPdfOptions,
): Promise<BuildGuardedPdfResult> {
  const scale = options.scale ?? 2;
  const format = options.imageFormat ?? "image/png";
  const quality = options.jpegQuality ?? 0.85;
  const scope = options.scope ?? "all";

  const sourceDoc = await loadPdf(pdfBytes);
  const pageCount = sourceDoc.numPages;

  try {
    const outDoc = await PDFDocument.create();
    const instances: GuardPlan["instances"] = [];
    const warnings: PlanWarning[] = [];
    const pageSizes = new Map<number, PageSize>();
    let backgroundHex: string | null = null;
    let merged: GuardPlan | null = null;

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      if (options.signal?.aborted) throw new Error("Raster Guard generation cancelled by user");

      const pageIndex = pageNumber - 1;
      const page = await sourceDoc.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const canvas = await renderPageToCanvas(page, { scale, whiteBackground: true });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not acquire a 2D canvas context for the guarded page");

      const layout = await readPageLayout(page, pageIndex);
      const rendered = context.getImageData(0, 0, canvas.width, canvas.height);
      const pageLayout: PageLayout = {
        ...layout,
        occupied: [
          ...layout.occupied,
          ...inkBoxesFromImageData(rendered, layout.widthPt, layout.heightPt, {
            rasterScale: scale,
          }),
        ],
      };
      pageSizes.set(pageIndex, { widthPt: layout.widthPt, heightPt: layout.heightPt });

      if (scope === "all" || pageIndex === 0) {
        const pagePlan = buildGuardPlan({
          pages: [pageLayout],
          noticeText: options.noticeText,
          compactNoticeText: options.compactNoticeText,
          watermarkText: options.watermarkText,
          tier: options.tier,
          targetProviders: options.targetProviders,
          rasterScale: scale,
          channels: options.channels,
          expectedSignals: options.expectedSignals,
        });
        merged = pagePlan;
        instances.push(...pagePlan.instances);
        warnings.push(...pagePlan.warnings);

        const first = pagePlan.instances[0];
        if (backgroundHex === null && first) {
          backgroundHex = sampleBackgroundHex(
            rendered,
            first.rect,
            layout.widthPt,
            layout.heightPt,
          );
        }

        // Draw in points: the context carries the raster scale, so the plan's
        // point coordinates and `Npx` font sizes line up one to one.
        context.save();
        context.scale(scale, scale);
        stampPageInstances(adaptStampContext(context), pagePlan, pageIndex);
        context.restore();
      }

      const imageBytes = await canvasToImageBytes(canvas, format, quality);
      const embedded =
        format === "image/jpeg"
          ? await outDoc.embedJpg(imageBytes)
          : await outDoc.embedPng(imageBytes);
      const outPage = outDoc.addPage([unscaled.width, unscaled.height]);
      outPage.drawImage(embedded, { x: 0, y: 0, width: unscaled.width, height: unscaled.height });

      options.onProgress?.({
        current: pageNumber,
        total: pageCount,
        percent: Math.round((pageNumber / pageCount) * 100),
      });
    }

    const bytes = await outDoc.save();
    const { isTextFree, totalExtractedCharacters } = await verifyTextFree(bytes);

    return {
      bytes,
      pageCount,
      originalSizeBytes: pdfBytes.byteLength,
      guardedSizeBytes: bytes.byteLength,
      scaleUsed: scale,
      formatUsed: format,
      plan: {
        instances,
        warnings,
        noticeText: options.noticeText,
        compactNoticeText: options.compactNoticeText,
        watermarkText: options.watermarkText,
        tier: options.tier,
        targetProviders: options.targetProviders,
        expectedSignals: merged?.expectedSignals ?? options.expectedSignals ?? [],
      },
      pageSizes,
      backgroundHex: backgroundHex ?? "#ffffff",
      isTextFree,
      totalExtractedCharacters,
    };
  } finally {
    await sourceDoc.destroy();
  }
}

/**
 * Confirms the output really is text-free.
 *
 * Best effort by design: a verification failure is reported, never thrown. The
 * guarded PDF is still the artifact the professor asked for, and the result
 * card says plainly when the check could not run.
 */
async function verifyTextFree(
  bytes: Uint8Array,
): Promise<{ isTextFree: boolean; totalExtractedCharacters: number }> {
  try {
    const doc = await loadPdf(bytes);
    let total = 0;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      total += (await extractPageText(page)).text.trim().length;
    }
    await doc.destroy();
    return { isTextFree: total === 0, totalExtractedCharacters: total };
  } catch {
    return { isTextFree: false, totalExtractedCharacters: 0 };
  }
}
