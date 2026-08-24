// pdfjs-dist legacy build runs under Bun with worker fetching and dynamic
// evaluation disabled for deterministic server-side extraction.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const STANDARD_FONT_DATA_URL = (() => {
  const pdfjsPkgUrl = import.meta.resolve("pdfjs-dist/package.json");
  const packageDir = new URL(pdfjsPkgUrl).pathname.replace(/\/package\.json$/, "");
  return `${packageDir}/standard_fonts/`;
})();

export interface ExtractTextInput {
  bytes: Uint8Array;
  targetInstruction: string;
  /** The first injected page. Ignored when `targetPageIndexes` is given. */
  targetPageIndex: number;
  /**
   * Every injected page, for `targetPage: "all"`. When present,
   * `targetPageMatch` means *every* one of these pages matched — a single page
   * losing the payload must not read as a clean extraction.
   */
  targetPageIndexes?: number[];
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

/** Shared pdf.js document load, used by both `extractText` and `extractPagesText`. */
async function loadPdf(bytes: Uint8Array) {
  const loadingTask = pdfjsLib.getDocument({
    // pdf.js takes ownership of `data` and detaches its underlying
    // ArrayBuffer once loaded (documented upstream behavior, to avoid a
    // copy) — pass a defensive copy so the caller's buffer stays usable
    // (e.g. for byteLength / sizeBytes reads) after this call returns.
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  return loadingTask.promise;
}

async function getPageText(
  pdf: Awaited<ReturnType<typeof loadPdf>>,
  pageNumber: number,
): Promise<string> {
  const page = await pdf.getPage(pageNumber); // pdfjs pages are 1-based
  const textContent = await page.getTextContent();
  return textContent.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

/**
 * Server-side text extraction via pdfjs-dist's legacy build (`getTextContent()`
 * per page). PRD §13.3: records exact / whitespace-normalized / case-
 * insensitive match against the target instruction for every page.
 */
export async function extractText(input: ExtractTextInput): Promise<ExtractTextResult> {
  const pdf = await loadPdf(input.bytes);

  const normalizedTarget = collapseWhitespace(input.targetInstruction);
  const lowerTarget = input.targetInstruction.toLowerCase();

  const pages: PageTextMatch[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const text = await getPageText(pdf, i + 1);

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

  const targetIndexes = input.targetPageIndexes?.length
    ? input.targetPageIndexes
    : [input.targetPageIndex];
  const targetPageMatch = targetIndexes.every((index) => {
    const page = pages[index];
    return page ? page.exactMatch || page.normalizedMatch : false;
  });
  const anyPageMatch = pages.some((p) => p.exactMatch || p.normalizedMatch);

  return {
    pdfJsVersion: pdfjsLib.version,
    pages,
    targetPageMatch,
    anyPageMatch,
  };
}

/**
 * Extracts raw page text (in page order, no match-checking) via the same
 * pdfjs-dist legacy build as `extractText`. Additive helper for the round-2
 * addendum §6 Ollama adapter (`packages/benchmark`'s `createOllamaAdapter`),
 * which needs full page text to send as a text-only chat message since
 * Ollama cannot ingest a PDF document directly. Does not change or replace
 * `extractText`'s existing API/behavior.
 */
export async function extractPagesText(bytes: Uint8Array): Promise<string[]> {
  const pdf = await loadPdf(bytes);
  const pages: string[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    pages.push(await getPageText(pdf, i + 1));
  }
  return pages;
}
