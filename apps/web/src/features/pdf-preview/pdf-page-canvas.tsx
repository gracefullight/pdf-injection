import { useEffect, useRef, useState } from "react";
import { type PDFDocumentProxy, type PDFPageProxy, renderPageToCanvas } from "@/lib/pdfjs";

export interface PdfPageCanvasProps {
  document: PDFDocumentProxy | null;
  /** 1-based page number, matching PDF.js's `getPage()` convention. */
  pageNumber: number;
  scale?: number;
  /** Enables selectable text and clickable PDF annotations. Disable inside button thumbnails. */
  interactive?: boolean;
  className?: string;
  "data-testid"?: string;
}

interface RenderedInteractivePdfPage {
  element: HTMLDivElement;
  cleanup: () => void;
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

async function renderInteractivePdfPage(
  document: PDFDocumentProxy,
  page: PDFPageProxy,
  pageNumber: number,
  options: { scale: number; whiteBackground: boolean },
): Promise<RenderedInteractivePdfPage> {
  const { AnnotationLayerBuilder, SimpleLinkService, TextLayerBuilder } = await import(
    "pdfjs-dist/web/pdf_viewer.mjs"
  );
  const viewport = page.getViewport({ scale: options.scale });
  const surface = window.document.createElement("div");
  surface.className = "pdf-page-surface";
  surface.setAttribute("role", "img");
  surface.setAttribute("aria-label", `Page ${pageNumber} preview`);
  surface.style.width = `${viewport.width}px`;
  surface.style.maxWidth = "100%";
  surface.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  surface.style.setProperty("--scale-factor", "1");

  const canvas = await renderPageToCanvas(page, options);
  canvas.setAttribute("aria-hidden", "true");
  surface.append(canvas);

  const textLayer = new TextLayerBuilder({
    pdfPage: page,
    enablePermissions: true,
  });
  surface.append(textLayer.div);

  const linkService = new SimpleLinkService();
  linkService.setDocument(document);
  const annotationLayer = new AnnotationLayerBuilder({
    pdfPage: page,
    linkService,
    annotationStorage: document.annotationStorage,
    renderForms: false,
    onAppend: (layer: HTMLDivElement) => surface.append(layer),
  });

  await Promise.all([
    textLayer.render(viewport, { includeMarkedContent: true }),
    annotationLayer.render(viewport, {}),
  ]);

  const updateResponsiveScale = () => {
    const displayedWidth = surface.getBoundingClientRect().width;
    if (displayedWidth > 0) {
      surface.style.setProperty("--scale-factor", String(displayedWidth / viewport.width));
    }
  };
  const resizeObserver = new ResizeObserver(updateResponsiveScale);
  resizeObserver.observe(surface);

  return {
    element: surface,
    cleanup: () => {
      resizeObserver.disconnect();
      textLayer.cancel();
      annotationLayer.cancel();
    },
  };
}

/** Renders a single PDF.js page into a `<canvas>`, re-rendering when the page/scale changes. */
export function PdfPageCanvas({
  document,
  pageNumber,
  scale = 1.2,
  interactive = true,
  className,
  ...rest
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let cleanupRenderedPage: (() => void) | undefined;
    setError(null);

    if (!document) return;

    const renderPromise = interactive
      ? document.getPage(pageNumber).then((page) =>
          renderInteractivePdfPage(document, page, pageNumber, {
            scale,
            whiteBackground: true,
          }),
        )
      : renderPdfPage(document, pageNumber, { scale, whiteBackground: true }).then((canvas) => ({
          element: canvas,
          cleanup: () => undefined,
        }));

    renderPromise
      .then(({ element, cleanup }) => {
        if (cancelled || !containerRef.current) {
          cleanup();
          return;
        }
        cleanupRenderedPage = cleanup;
        containerRef.current.replaceChildren(element);
        if (element instanceof HTMLCanvasElement) {
          element.setAttribute("role", "img");
          element.setAttribute("aria-label", `Page ${pageNumber} preview`);
        }
        // Fit-to-width via CSS (keeps the backing pixel resolution from `scale` for crispness,
        // just scales the display size down to the container) — the page is rendered at a fixed
        // intrinsic pixel size, but every container this component is used in (Human View panes,
        // the Upload thumbnail) is narrower than a full 612pt+ page at any reasonable scale, so
        // without this the right portion of every page was clipped instead of visible
        // side-by-side (r11 review H-03, M-01).
        element.style.display = "block";
        element.style.width = "100%";
        element.style.height = "auto";
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render page");
      });

    return () => {
      cancelled = true;
      cleanupRenderedPage?.();
    };
  }, [document, interactive, pageNumber, scale]);

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
