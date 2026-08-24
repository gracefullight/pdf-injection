import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PdfPageCanvas } from "@/features/pdf-preview/pdf-page-canvas";
import type { PDFDocumentProxy } from "@/lib/pdfjs";

export interface HumanViewTabProps {
  sourceDocument: PDFDocumentProxy | null;
  outputDocument: PDFDocumentProxy | null;
  pageCount: number;
  /** 0-based target page index the hidden instruction was injected into, when known. */
  targetPageIndex?: number | null;
  /**
   * Every 0-based injected page — more than one only for `targetPage: "all"`.
   * Falls back to `[targetPageIndex]` when absent.
   */
  targetPageIndexes?: number[] | null;
}

/** "1", "1 and 4", "1, 4 and 7" — reads as prose inside the target-page note. */
function formatPageList(pageNumbers: number[]): string {
  if (pageNumbers.length <= 1) return String(pageNumbers[0] ?? "");
  const head = pageNumbers.slice(0, -1).join(", ");
  return `${head} and ${pageNumbers[pageNumbers.length - 1]}`;
}

/** Screen 4 "Human View" tab — original vs. modified PDF, side-by-side, with page navigation. */
export function HumanViewTab({
  sourceDocument,
  outputDocument,
  pageCount,
  targetPageIndex,
  targetPageIndexes,
}: HumanViewTabProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const targetPageNumbers = targetPageIndexes?.length
    ? targetPageIndexes.map((index) => index + 1)
    : typeof targetPageIndex === "number"
      ? [targetPageIndex + 1]
      : [];
  const everyPage = pageCount > 1 && targetPageNumbers.length >= pageCount;
  // Where "Go to page" should jump: the first injected page that isn't already
  // on screen. With every page injected there is nowhere to jump to.
  const nextTargetPage = everyPage
    ? undefined
    : targetPageNumbers.find((number) => number !== pageNumber);

  return (
    <div className="flex flex-col gap-4" data-testid="human-view-tab">
      {targetPageNumbers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="human-view-target-page-note">
            {everyPage
              ? `The hidden instruction was injected on every page (${pageCount}).`
              : `The hidden instruction was injected on ${
                  targetPageNumbers.length > 1 ? "pages" : "page"
                } ${formatPageList(targetPageNumbers)}.`}
          </span>
          {nextTargetPage !== undefined && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPageNumber(nextTargetPage)}
              data-testid="human-view-go-to-target-page"
            >
              Go to page {nextTargetPage}
            </Button>
          )}
        </div>
      )}
      <div className="flex items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
          data-testid="human-view-prev-page"
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground" data-testid="human-view-page-indicator">
          Page {pageNumber} of {Math.max(1, pageCount)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber((n) => Math.min(pageCount, n + 1))}
          data-testid="human-view-next-page"
        >
          Next
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Original</p>
          <div className="overflow-auto rounded border border-border">
            <PdfPageCanvas
              document={sourceDocument}
              pageNumber={pageNumber}
              scale={1}
              data-testid="human-view-source-canvas"
            />
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">Modified</p>
          <div className="overflow-auto rounded border border-border">
            <PdfPageCanvas
              document={outputDocument}
              pageNumber={pageNumber}
              scale={1}
              data-testid="human-view-output-canvas"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
