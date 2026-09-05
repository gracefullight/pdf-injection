import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PdfPageCanvas } from "@/features/pdf-preview/pdf-page-canvas";
import type { PDFDocumentProxy } from "@/lib/pdfjs";

export interface PdfFullPreviewDialogProps {
  document: PDFDocumentProxy | null;
  pageCount: number;
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Larger than the Upload screen's `scale={0.5}` thumbnail — this is the "look closely" view. */
const FULL_PREVIEW_SCALE = 1.5;

interface LazyPdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  scrollRoot: Element | null;
}

/**
 * Renders one page of the fullscreen preview, but only once it has scrolled near the visible
 * area. A 100-page document (the app's own upload limit — see `LIMITS.maxPages`) rendered eagerly
 * at `FULL_PREVIEW_SCALE` would mean 100 concurrent PDF.js page renders the moment the dialog
 * opens; observing each placeholder instead means only the pages the reader actually scrolls to
 * ever get rendered; a `600px` root margin pre-renders roughly one screen ahead so scrolling still
 * feels instant. Once rendered, a page stays mounted (no un-rendering on scroll-away) — trading a
 * bounded amount of memory for not re-rendering a page the reader scrolls back to.
 */
function LazyPdfPage({ document, pageNumber, scrollRoot }: LazyPdfPageProps) {
  const [isVisible, setIsVisible] = useState(false);
  const placeholderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isVisible) return;
    const node = placeholderRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsVisible(true);
      },
      { root: scrollRoot, rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, scrollRoot]);

  if (!isVisible) {
    return (
      <div
        ref={placeholderRef}
        className="aspect-[3/4] w-full max-w-2xl shrink-0 rounded border border-border bg-muted"
        aria-hidden="true"
        data-testid={`pdf-full-preview-page-placeholder-${pageNumber}`}
      />
    );
  }

  return (
    <div className="w-full max-w-2xl shrink-0 overflow-visible rounded border border-border">
      <PdfPageCanvas
        document={document}
        pageNumber={pageNumber}
        scale={FULL_PREVIEW_SCALE}
        data-testid={`pdf-full-preview-page-${pageNumber}`}
      />
    </div>
  );
}

/**
 * Fullscreen, scrollable view of every page of the currently-loaded PDF — opened from the Upload
 * screen's small page-1 thumbnail. Reuses the already-loaded `usePdfDocument` proxy (no re-fetch)
 * and renders pages lazily via `LazyPdfPage` so opening a large document doesn't render all of it
 * at once.
 */
export function PdfFullPreviewDialog({
  document,
  pageCount,
  fileName,
  open,
  onOpenChange,
}: PdfFullPreviewDialogProps) {
  const [scrollNode, setScrollNode] = useState<HTMLDivElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[90vh] w-full max-w-3xl flex-col gap-4 motion-reduce:transition-none sm:h-[85vh]"
        data-testid="pdf-full-preview-dialog"
      >
        <DialogHeader>
          <DialogTitle className="truncate">{fileName}</DialogTitle>
          <DialogDescription data-testid="pdf-full-preview-page-count">
            {pageCount} {pageCount === 1 ? "page" : "pages"}
          </DialogDescription>
        </DialogHeader>

        <div
          ref={setScrollNode}
          className="flex min-h-0 flex-1 flex-col items-center gap-4 overflow-y-auto overflow-x-hidden rounded border border-border bg-muted/30 p-4"
          data-testid="pdf-full-preview-scroll"
        >
          {document ? (
            Array.from({ length: pageCount }, (_, index) => (
              <LazyPdfPage
                // biome-ignore lint/suspicious/noArrayIndexKey: pageNumber (index + 1) is a fixed, stable 1..pageCount identity for one loaded document — it never reorders.
                key={`page-${index + 1}`}
                document={document}
                pageNumber={index + 1}
                scrollRoot={scrollNode}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Loading document…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
