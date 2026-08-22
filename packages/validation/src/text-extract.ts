// pdfjs-dist legacy build runs under Bun (confirmed via a spike prior to
// building this module: getDocument({useWorkerFetch:false, isEvalSupported:
// false, disableFontFace:true}) loads and getTextContent() extracts text
// correctly; only a non-fatal "standardFontDataUrl" warning is logged).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// Note: pdfjs-dist logs a benign "Ensure that the standardFontDataUrl API
// parameter is provided" warning for pages using standard (non-embedded)
// fonts. Text extraction is unaffected (confirmed by the tests in this
// package); we intentionally don't wire up standardFontDataUrl to avoid
// depending on pdfjs-dist's internal font-file layout across versions.

export interface ExtractTextInput {
  bytes: Uint8Array;
  targetInstruction: string;
  targetPageIndex: number;
}

export interface PageTextMatch {
  pageIndex: number;
  textLength: number;
  exactMatch: boolean;
  normalizedMatch: boolean;
  caseInsensitiveMatch: boolean;
  matchOffset: number | null;
}

export interface ExtractTextResult {
  pdfJsVersion: string;
  pages: PageTextMatch[];
  targetPageMatch: boolean;
  anyPageMatch: boolean;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Server-side text extraction via pdfjs-dist's legacy build (`getTextContent()`
 * per page). PRD §13.3: records exact / whitespace-normalized / case-
 * insensitive match against the target instruction for every page.
 */
export async function extractText(input: ExtractTextInput): Promise<ExtractTextResult> {
  const loadingTask = pdfjsLib.getDocument({
    // pdf.js takes ownership of `data` and detaches its underlying
    // ArrayBuffer once loaded (documented upstream behavior, to avoid a
    // copy) — pass a defensive copy so the caller's buffer stays usable
    // (e.g. for byteLength / sizeBytes reads) after this call returns.
    data: input.bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;

  const normalizedTarget = collapseWhitespace(input.targetInstruction);
  const lowerTarget = input.targetInstruction.toLowerCase();

  const pages: PageTextMatch[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1); // pdfjs pages are 1-based
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");

    const matchOffsetRaw = text.indexOf(input.targetInstruction);
    const exactMatch = matchOffsetRaw !== -1;
    const normalizedMatch = collapseWhitespace(text).includes(normalizedTarget);
    const caseInsensitiveMatch = text.toLowerCase().includes(lowerTarget);

    pages.push({
      pageIndex: i,
      textLength: text.length,
      exactMatch,
      normalizedMatch,
      caseInsensitiveMatch,
      matchOffset: exactMatch ? matchOffsetRaw : null,
    });
  }

  const targetPage = pages[input.targetPageIndex];
  const targetPageMatch = targetPage ? targetPage.exactMatch || targetPage.normalizedMatch : false;
  const anyPageMatch = pages.some((p) => p.exactMatch || p.normalizedMatch);

  return {
    pdfJsVersion: pdfjsLib.version,
    pages,
    targetPageMatch,
    anyPageMatch,
  };
}
