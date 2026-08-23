import { PDFDocument } from "pdf-lib";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";

export interface InjectInfoDictInput {
  doc: PDFDocument;
  instruction: string;
  promptSha256: string;
}

/**
 * INFO-01 (info_dict) — round-3 research/diagnostic condition: stores the
 * hidden instruction ONLY in the document's classic `/Info` dictionary
 * (Subject + Keywords). No page content stream is touched — geometry and
 * visible/extracted page content are byte-for-byte unaffected, like
 * xmp_only. Distinct from xmp_only: this targets the metadata-HEADER
 * extraction path some text-extractor families expose independently of XMP
 * (e.g. poppler's `pdfinfo`, pypdf's `reader.metadata`), not the XMP
 * `/Metadata` stream path.
 *
 * The document's original `/Info /Title` (if any) is left untouched —
 * `PDFDocument.setSubject`/`setKeywords` only ever write their own
 * `/Subject`/`/Keywords` keys on the shared Info dict (verified in
 * `packages/pdf-engine/test/inject-info-dict.test.ts`). Both setters
 * encode via pdf-lib's own `PDFHexString.fromText` internally, so
 * non-ASCII (`payloadLanguage="ko"`) instructions round-trip correctly with
 * no font embedding required (nothing is drawn).
 *
 * Returns boundingBox=[0,0,0,0] and fontSize=0 (no drawn text), matching
 * xmp_only's InjectTextResult shape for manifest continuity.
 */
export async function injectInfoDict(input: InjectInfoDictInput): Promise<InjectTextResult> {
  try {
    const { doc, instruction, promptSha256 } = input;
    doc.setSubject(instruction);
    doc.setKeywords([instruction, `pdfi:${promptSha256}`]);
    return { boundingBox: [0, 0, 0, 0], fontSize: 0 };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`info_dict injection failed: ${(err as Error).message}`);
  }
}

export interface InfoDictPayload {
  title: string | null;
  subject: string | null;
  keywords: string | null;
}

/**
 * Reads back the classic `/Info` dictionary's Title/Subject/Keywords of a
 * PDF, for server-side validation and tests — independent of pdfjs-dist
 * text extraction (this metadata is never part of a page's text content).
 */
export async function readInfoDictPayload(bytes: Uint8Array): Promise<InfoDictPayload> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    title: doc.getTitle() ?? null,
    subject: doc.getSubject() ?? null,
    keywords: doc.getKeywords() ?? null,
  };
}
