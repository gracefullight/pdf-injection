import { useEffect, useRef, useState } from "react";
import { type DocumentInfo, getDocumentInfo, loadPdf, type PDFDocumentProxy } from "@/lib/pdfjs";

export interface UsePdfDocumentResult {
  document: PDFDocumentProxy | null;
  info: DocumentInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads a PDF from raw bytes via PDF.js and tracks its lifecycle. Destroys the
 * document proxy on unmount / bytes change to release worker-side memory.
 */
export function usePdfDocument(bytes: Uint8Array | null): UsePdfDocumentResult {
  const [state, setState] = useState<UsePdfDocumentResult>({
    document: null,
    info: null,
    loading: false,
    error: null,
  });
  const docRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }

    if (!bytes) {
      setState({ document: null, info: null, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    loadPdf(bytes)
      .then(async (doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        const info = await getDocumentInfo(doc);
        if (cancelled) return;
        setState({ document: doc, info, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          document: null,
          info: null,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load PDF",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  useEffect(() => {
    return () => {
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, []);

  return state;
}
