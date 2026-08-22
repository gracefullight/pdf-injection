import { describe, expect, it } from "bun:test";
import { renderPdfPage } from "@/features/pdf-preview/pdf-page-canvas";
import type { PDFDocumentProxy } from "@/lib/pdfjs";

/**
 * Regression coverage for the cross-scope fix in `pdf-page-canvas.tsx`:
 * `PDFDocumentProxy.getPage()` can throw *synchronously* (not just reject)
 * once the underlying PDF.js worker transport has been torn down (observed
 * in practice when a sibling `usePdfDocument` cleanup races a document
 * swap/unmount). `renderPdfPage` is an `async function`, which the JS engine
 * automatically converts any synchronous throw inside into a rejected
 * promise — these tests assert that conversion holds for both a
 * synchronous throw and a promise-returning rejection, without needing to
 * render a React tree or spin up a real PDF.js worker.
 */
describe("renderPdfPage", () => {
  it("converts a synchronous getPage() throw into a rejected promise instead of throwing", async () => {
    const doc = {
      getPage: () => {
        throw new Error("Worker transport destroyed");
      },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(doc, 1, { scale: 1, whiteBackground: true })).rejects.toThrow(
      "Worker transport destroyed",
    );
  });

  it("propagates an asynchronous (already-rejected-promise) getPage() failure the same way", async () => {
    const doc = {
      getPage: () => Promise.reject(new Error("Worker transport destroyed")),
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(doc, 1, { scale: 1, whiteBackground: true })).rejects.toThrow(
      "Worker transport destroyed",
    );
  });

  it("awaits getPage() with the requested page number before rendering", async () => {
    // Object holder (rather than a bare `let`) so TS doesn't narrow the
    // captured variable to its initializer's type at the assertion below —
    // the mutation only happens inside the `getPage` closure, outside the
    // linear control flow `it()`'s body.
    const captured: { pageNumber: number | null } = { pageNumber: null };
    const doc = {
      getPage: async (pageNumber: number) => {
        captured.pageNumber = pageNumber;
        // Rejecting here (rather than resolving to a fake PDFPageProxy) keeps
        // this test independent of `renderPageToCanvas()`'s real PDF.js/DOM
        // canvas rendering, while still proving `getPage` was called and
        // awaited with the right argument before any render step ran.
        throw new Error("stop before rendering");
      },
    } as unknown as PDFDocumentProxy;

    await expect(renderPdfPage(doc, 5, { scale: 2, whiteBackground: true })).rejects.toThrow();
    expect(captured.pageNumber).toBe(5);
  });
});
