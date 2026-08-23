// Round-2 §3 submissions: raw full-document text extraction for scoring
// (distinct from packages/validation's `extractText`, which only returns
// per-page match booleans against a known target instruction — submissions
// need the actual extracted text of an arbitrary uploaded PDF to run
// @pdf-injection/detector's signal matchers against).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const STANDARD_FONT_DATA_URL = (() => {
  const pdfjsPkgUrl = import.meta.resolve("pdfjs-dist/package.json");
  const packageDir = new URL(pdfjsPkgUrl).pathname.replace(/\/package\.json$/, "");
  return `${packageDir}/standard_fonts/`;
})();

/** Extracts and joins the text content of every page of a PDF. */
export async function extractFullPdfText(bytes: Uint8Array): Promise<string> {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: unknown) =>
        item && typeof item === "object" && "str" in item ? (item as { str: string }).str : "",
      )
      .join(" ");
    pageTexts.push(text);
  }
  return pageTexts.join("\n\n");
}
