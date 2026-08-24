import type { Position } from "@pdf-injection/contracts";
import {
  beginText,
  decodePDFRawStream,
  endMarkedContent,
  endText,
  PDFArray,
  PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFRawStream,
  StandardFonts,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";

/** Fixed non-instruction glyph content used to distinguish ordinary extraction from `/ActualText`. */
export const ACTUAL_TEXT_DECOY = "PDF accessibility span";
/** Custom marked-content property used by the structural read-back gate. */
export const ACTUAL_TEXT_PROMPT_SHA256_KEY = "PdfiPromptSha256";

export interface InjectActualTextInput {
  doc: PDFDocument;
  pageIndex: number;
  instruction: string;
  promptSha256: string;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  /** The decoy is ASCII, so Helvetica is sufficient; callers may still supply an existing font. */
  font?: PDFFont;
}

/**
 * ACTUALTEXT-01 — accessibility-semantics probe.
 *
 * The page content stream contains only the fixed `ACTUAL_TEXT_DECOY` glyphs,
 * drawn under text rendering mode 3 so they paint no pixels. The real
 * instruction exists only as `/ActualText` on a marked-content span:
 *
 *   /Span << /ActualText <...> /PdfiPromptSha256 <...> >> BDC
 *     BT ... 3 Tr ... (decoy) Tj ET
 *   EMC
 *
 * A conventional content-stream extractor therefore sees the decoy (or
 * nothing), while an accessibility-aware extractor substitutes the
 * instruction. This makes the provider result diagnostic: matching the
 * instruction indicates that its ingestion path honours `/ActualText`, not
 * merely that it walks invisible `Tj` operators like `render_mode_3`.
 */
export async function injectActualText(input: InjectActualTextInput): Promise<InjectTextResult> {
  try {
    const { doc, pageIndex, instruction, promptSha256 } = input;
    const page = doc.getPage(pageIndex);
    const font = input.font ?? (await doc.embedFont(StandardFonts.Helvetica));
    const fontSize = input.fontSize ?? 1;
    const lineHeight = fontSize * 1.2;
    const maxWidth = input.maxWidth ?? page.getWidth() - 2 * DEFAULT_MARGIN_X;
    const lines = wrapTextToLines(ACTUAL_TEXT_DECOY, font, fontSize, maxWidth);
    const layout = layoutTextBlock({
      pageWidth: page.getWidth(),
      pageHeight: page.getHeight(),
      lines,
      fontSize,
      lineHeight,
      maxWidth,
      position: input.position,
      x: input.x,
      y: input.y,
      font,
    });

    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const properties = doc.context.obj({
      ActualText: PDFHexString.fromText(instruction),
      [ACTUAL_TEXT_PROMPT_SHA256_KEY]: PDFHexString.fromText(promptSha256),
    });
    const beginActualText = PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
      PDFName.of("Span"),
      properties.toString(),
    ]);

    page.pushOperators(
      beginActualText,
      beginText(),
      setFontAndSize(fontKey, fontSize),
      setTextRenderingMode(TextRenderingMode.Invisible),
    );
    lines.forEach((line, index) => {
      const position = layout.linePositions[index];
      if (!position) return;
      page.pushOperators(
        setTextMatrix(1, 0, 0, 1, position.x, position.y),
        showText(font.encodeText(line)),
      );
    });
    page.pushOperators(endText(), endMarkedContent());

    return { boundingBox: layout.boundingBox, fontSize };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`actual_text injection failed: ${(err as Error).message}`);
  }
}

export interface ActualTextPayload {
  payloadPresent: boolean;
  actualTexts: string[];
  promptSha256Values: string[];
}

const ACTUAL_TEXT_HEX_RE = /\/ActualText\s*<([0-9A-Fa-f]+)>/g;
const PROMPT_SHA256_HEX_RE = /\/PdfiPromptSha256\s*<([0-9A-Fa-f]+)>/g;

function decodeHexMatches(content: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match = pattern.exec(content);
  while (match) {
    values.push(PDFHexString.of(match[1] as string).decodeText());
    match = pattern.exec(content);
  }
  return values;
}

function decodedPageContent(doc: PDFDocument, pageIndex: number): string {
  const contents = doc.getPage(pageIndex).node.Contents();
  if (!contents) return "";
  const streams =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
      : [contents as PDFRawStream];

  return streams
    .map((stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode()))
    .join("\n");
}

/**
 * Reads `/ActualText` and the probe hash directly from a page's decoded
 * content streams. This is independent of PDF.js text extraction and is used
 * to prevent a silently missing marked-content payload from passing.
 */
export async function readActualTextPayload(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<ActualTextPayload> {
  const doc = await PDFDocument.load(bytes);
  const content = decodedPageContent(doc, pageIndex);
  const actualTexts = decodeHexMatches(content, ACTUAL_TEXT_HEX_RE);
  const promptSha256Values = decodeHexMatches(content, PROMPT_SHA256_HEX_RE);
  return {
    payloadPresent: actualTexts.length > 0 && promptSha256Values.length > 0,
    actualTexts,
    promptSha256Values,
  };
}
