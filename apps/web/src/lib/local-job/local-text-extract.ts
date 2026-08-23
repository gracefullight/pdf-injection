import type { ValidationReport } from "@pdf-injection/contracts";
import { extractPageText, loadPdf, pdfJsVersion } from "@/lib/pdfjs";

/**
 * Browser twin of `@pdf-injection/validation`'s server-side `extractText()`.
 *
 * The server version cannot be reused as-is: it imports pdf.js's *legacy*
 * build and resolves `standard_fonts/` through `import.meta.resolve`, both of
 * which are Node-only. This runs the identical comparison rules (exact /
 * whitespace-collapsed / case-insensitive, per page) through the app's
 * already-configured browser pdf.js worker (`@/lib/pdfjs`), and returns the
 * exact same shape so `buildReport()` consumes it unchanged.
 */
export type LocalExtractTextResult = ValidationReport["serverValidation"]["textExtraction"];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface LocalExtractTextInput {
  bytes: Uint8Array;
  targetInstruction: string;
  targetPageIndex: number;
}

export async function extractTextInBrowser(
  input: LocalExtractTextInput,
): Promise<LocalExtractTextResult> {
  const pdf = await loadPdf(input.bytes);
  try {
    const normalizedTarget = collapseWhitespace(input.targetInstruction);
    const lowerTarget = input.targetInstruction.toLowerCase();

    const pages: LocalExtractTextResult["pages"] = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const page = await pdf.getPage(i + 1);
      const { text } = await extractPageText(page);

      const matchOffsetRaw = text.indexOf(input.targetInstruction);
      const exactMatch = matchOffsetRaw !== -1;

      pages.push({
        pageIndex: i,
        textLength: text.length,
        exactMatch,
        normalizedMatch: collapseWhitespace(text).includes(normalizedTarget),
        caseInsensitiveMatch: text.toLowerCase().includes(lowerTarget),
        matchOffset: exactMatch ? matchOffsetRaw : null,
      });
    }

    const targetPage = pages[input.targetPageIndex];
    return {
      pdfJsVersion,
      pages,
      targetPageMatch: targetPage ? targetPage.exactMatch || targetPage.normalizedMatch : false,
      anyPageMatch: pages.some((page) => page.exactMatch || page.normalizedMatch),
    };
  } finally {
    await pdf.destroy();
  }
}
