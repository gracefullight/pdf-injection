import type { ClientValidationInput, InjectionMode } from "@pdf-injection/contracts";
import { diffThreshold } from "@pdf-injection/contracts";
import { useCallback, useState } from "react";
import { computeTextMatch } from "@/features/extracted-text/text-match";
import {
  aggregateVisualDiff,
  computePageDiff,
  type PageDiffResult,
} from "@/features/visual-diff/diff-metrics";
import { extractPageText, loadPdf, pdfJsVersion, renderPageToCanvas } from "@/lib/pdfjs";

export interface ClientValidationComputation {
  input: ClientValidationInput;
  pageDiffs: PageDiffResult[];
  extractedPageTexts: string[];
}

export interface UseClientValidationState {
  computing: boolean;
  error: string | null;
  result: ClientValidationComputation | null;
}

function canvasToImageData(canvas: HTMLCanvasElement): ImageData {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not acquire 2D canvas context");
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Renders source vs. output at scale 2 / white background, computes the
 * pixelmatch-based visual diff and PDF.js text extraction for every page, and
 * assembles the `ClientValidationInput` body posted to `/jobs/:id/client-validation`.
 */
export function useClientValidation() {
  const [state, setState] = useState<UseClientValidationState>({
    computing: false,
    error: null,
    result: null,
  });

  const compute = useCallback(
    async (
      sourceBytes: Uint8Array,
      outputBytes: Uint8Array,
      mode: InjectionMode,
      targetPageIndex: number,
      normalizedInstruction: string,
    ): Promise<ClientValidationComputation | null> => {
      setState({ computing: true, error: null, result: null });
      const renderErrors: string[] = [];

      let sourceDoc: Awaited<ReturnType<typeof loadPdf>> | null = null;
      let outputDoc: Awaited<ReturnType<typeof loadPdf>> | null = null;

      try {
        [sourceDoc, outputDoc] = await Promise.all([loadPdf(sourceBytes), loadPdf(outputBytes)]);

        if (sourceDoc.numPages !== outputDoc.numPages) {
          renderErrors.push(
            `Page count mismatch: source=${sourceDoc.numPages}, output=${outputDoc.numPages}`,
          );
        }

        const pageCount = outputDoc.numPages;
        const pageDiffs: PageDiffResult[] = [];
        const extractedPageTexts: string[] = [];
        const extractionPages: ClientValidationInput["extractedText"]["pages"] = [];
        // No mode-aware comparison target: pdfjs filters Cf-category codepoints, so neither the
        // plain nor the tag-encoded instruction can ever match for unicode_tags. Keeping the plain
        // instruction here matches every other mode and keeps the parser view honest.

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          const pageNumber = pageIndex + 1;
          try {
            const [sourcePage, outputPage] = await Promise.all([
              sourceDoc.getPage(Math.min(pageNumber, sourceDoc.numPages)),
              outputDoc.getPage(pageNumber),
            ]);
            const [sourceCanvas, outputCanvas] = await Promise.all([
              renderPageToCanvas(sourcePage, { scale: 2, whiteBackground: true }),
              renderPageToCanvas(outputPage, { scale: 2, whiteBackground: true }),
            ]);
            const sourceImage = canvasToImageData(sourceCanvas);
            const outputImage = canvasToImageData(outputCanvas);
            pageDiffs.push(computePageDiff(sourceImage, outputImage, pageIndex, mode));

            const { text } = await extractPageText(outputPage);
            extractedPageTexts.push(text);
            const match = computeTextMatch(text, normalizedInstruction);
            extractionPages.push({ pageIndex, textLength: text.length, ...match });
          } catch (pageError) {
            renderErrors.push(
              `Page ${pageNumber}: ${pageError instanceof Error ? pageError.message : "render/extract failed"}`,
            );
          }
        }

        const visualDiffAggregate = aggregateVisualDiff(pageDiffs, mode);
        const anyPageMatch = extractionPages.some(
          (page) => page.exactMatch || page.normalizedMatch || page.caseInsensitiveMatch,
        );
        const targetPageEntry = extractionPages.find((page) => page.pageIndex === targetPageIndex);
        const targetPageMatch = targetPageEntry
          ? targetPageEntry.exactMatch ||
            targetPageEntry.normalizedMatch ||
            targetPageEntry.caseInsensitiveMatch
          : false;

        const input: ClientValidationInput = {
          pdfJsVersion,
          renderPassed: renderErrors.length === 0,
          renderErrors,
          visualDiff: {
            scale: 2,
            // Persisted into ValidationReport.clientValidation for a professor reading the raw
            // report later; the server still recomputes pass/fail authoritatively via diffThreshold(mode).
            thresholdRatio: diffThreshold(mode),
            pages: pageDiffs.map((page) => ({
              pageIndex: page.pageIndex,
              width: page.width,
              height: page.height,
              changedPixels: page.changedPixels,
              changedPixelRatio: page.changedPixelRatio,
              maxChannelDelta: page.maxChannelDelta,
              meanAbsoluteDifference: page.meanAbsoluteDifference,
              passed: page.passed,
            })),
            changedPixelRatio: visualDiffAggregate.changedPixelRatio,
            passed: visualDiffAggregate.passed,
          },
          extractedText: {
            pages: extractionPages,
            targetPageMatch,
            anyPageMatch,
          },
        };

        const result: ClientValidationComputation = { input, pageDiffs, extractedPageTexts };
        setState({ computing: false, error: null, result });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Client-side validation failed";
        setState({ computing: false, error: message, result: null });
        return null;
      } finally {
        sourceDoc?.destroy();
        outputDoc?.destroy();
      }
    },
    [],
  );

  return { ...state, compute };
}
