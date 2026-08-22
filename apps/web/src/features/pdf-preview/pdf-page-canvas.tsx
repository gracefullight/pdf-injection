import { useEffect, useRef, useState } from "react";
import { type PDFDocumentProxy, renderPageToCanvas } from "@/lib/pdfjs";

export interface PdfPageCanvasProps {
  document: PDFDocumentProxy | null;
  /** 1-based page number, matching PDF.js's `getPage()` convention. */
  pageNumber: number;
  scale?: number;
  className?: string;
  "data-testid"?: string;
}

/**
 * Loads `pageNumber` from `document` and renders it to a `<canvas>`.
 *
 * Deliberately an `async function` — NOT `document.getPage(pageNumber).then(...)`
 * — so that a *synchronous* throw from `document.getPage()` is automatically
 * converted by the JS engine into a rejected promise instead of escaping as an
 * uncaught exception. This matters because `document.getPage()` genuinely can
 * throw synchronously (not just reject) if the underlying PDF.js worker
 * transport was already torn down by `usePdfDocument`'s cleanup (e.g. a
 * sibling effect racing a document swap/unmount) — React has no error
 * boundary around this component tree, so an uncaught synchronous throw here
 * unmounts the whole app to a blank page. Extracted as a pure, DOM-free
 * function (rather than left inline in the effect below) specifically so this
 * behavior has a regression test — see `pdf-page-canvas.test.ts` — that
 * doesn't require rendering a React tree or a PDF.js worker.
 */
export async function renderPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  options: { scale: number; whiteBackground: boolean },
): Promise<HTMLCanvasElement> {
  const page = await document.getPage(pageNumber);
  return renderPageToCanvas(page, options);
}

/** Renders a single PDF.js page into a `<canvas>`, re-rendering when the page/scale changes. */
export function PdfPageCanvas({
  document,
  pageNumber,
  scale = 1.2,
  className,
  ...rest
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    if (!document) return;

    renderPdfPage(document, pageNumber, { scale, whiteBackground: true })
      .then((canvas) => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.replaceChildren(canvas);
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Page ${pageNumber} preview`);
        // Fit-to-width via CSS (keeps the backing pixel resolution from `scale` for crispness,
        // just scales the display size down to the container) — the page is rendered at a fixed
        // intrinsic pixel size, but every container this component is used in (Human View panes,
        // the Upload thumbnail) is narrower than a full 612pt+ page at any reasonable scale, so
        // without this the right portion of every page was clipped instead of visible
        // side-by-side (r11 review H-03, M-01).
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "auto";
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render page");
      });

    return () => {
      cancelled = true;
    };
  }, [document, pageNumber, scale]);

  if (error) {
    return (
      <div className={className} role="alert" data-testid={rest["data-testid"]}>
        <p className="text-sm text-destructive">
          Could not render page {pageNumber}: {error}
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className={className} data-testid={rest["data-testid"]} />;
}
