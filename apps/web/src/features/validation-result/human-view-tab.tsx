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
}

/** Screen 4 "Human View" tab — original vs. modified PDF, side-by-side, with page navigation. */
export function HumanViewTab({
  sourceDocument,
  outputDocument,
  pageCount,
  targetPageIndex,
}: HumanViewTabProps) {
  const [pageNumber, setPageNumber] = useState(1);
  const targetPageNumber = typeof targetPageIndex === "number" ? targetPageIndex + 1 : null;

  return (
    <div className="flex flex-col gap-4" data-testid="human-view-tab">
      {targetPageNumber !== null && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span data-testid="human-view-target-page-note">
            The hidden instruction was injected on page {targetPageNumber}.
          </span>
          {pageNumber !== targetPageNumber && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPageNumber(targetPageNumber)}
              data-testid="human-view-go-to-target-page"
            >
              Go to page {targetPageNumber}
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
