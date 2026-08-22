import { LIMITS, type SourceInspection, type SourceRiskFlags } from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation";
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject } from "pdf-lib";
import { InvalidPdfError, PdfEncryptedError, PdfSignedError, TooManyPagesError } from "./errors";
import { snapshotPageGeometry } from "./page-geometry";

export interface InspectSourceInput {
  bytes: Uint8Array;
  filename: string;
  /** default: LIMITS.maxPages */
  maxPages?: number;
  /** default: LIMITS.maxPageDimensionPt */
  maxPageDimensionPt?: number;
}

const PDF_MAGIC = new TextEncoder().encode("%PDF-");

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

function extractPdfVersion(bytes: Uint8Array): string | null {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  const match = /%PDF-(\d\.\d)/.exec(head);
  return match ? (match[1] as string) : null;
}

/**
 * Detects a digital signature by scanning AcroForm fields for /FT /Sig, or a
 * catalog-level /Perms dict that specifically contains /DocMDP (certifying
 * signature) or /UR3 (usage rights signature) — NOT any /Perms entry, since
 * /Perms can also carry unrelated, non-signature usage-rights data and would
 * over-reject otherwise-unsigned PDFs.
 */
function isSignedDocument(doc: PDFDocument): boolean {
  const catalog = doc.catalog;

  const perms = catalog.lookupMaybe(PDFName.of("Perms"), PDFDict);
  if (perms && (perms.has(PDFName.of("DocMDP")) || perms.has(PDFName.of("UR3")))) {
    return true;
  }

  const acroForm = catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict);
  if (!acroForm) return false;

  const fields = acroForm.lookupMaybe(PDFName.of("Fields"), PDFArray);
  if (!fields) return false;

  for (let i = 0; i < fields.size(); i++) {
    const field = fields.lookupMaybe(i, PDFDict);
    if (!field) continue;

    const ft = field.lookupMaybe(PDFName.of("FT"), PDFName);
    if (ft === PDFName.of("Sig")) return true;

    const value = field.lookupMaybe(PDFName.of("V"), PDFDict);
    if (value) {
      const valueType = value.lookupMaybe(PDFName.of("Type"), PDFName);
      if (valueType === PDFName.of("Sig")) return true;
    }
  }

  return false;
}

interface RiskFlagAccumulator {
  javascript: boolean;
  embeddedFiles: boolean;
  externalUriCount: number;
}

/**
 * Recursively walks a dict/array's INLINE (non-indirect) sub-structure —
 * e.g. a Link annotation's /A action dict, or an OpenAction dict written
 * inline rather than as its own indirect object — looking for risk
 * indicators. Does not follow PDFRef (indirect references are enumerated
 * separately by the caller via context.enumerateIndirectObjects(), and
 * following them here would risk double-counting or cycles).
 */
function walkForRiskFlags(object: PDFObject, acc: RiskFlagAccumulator, depth: number): void {
  if (depth > 16) return; // guard against pathological nesting

  if (object instanceof PDFDict) {
    const subtype = object.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (subtype === PDFName.of("FileAttachment")) {
      acc.embeddedFiles = true;
    }

    const actionType = object.lookupMaybe(PDFName.of("S"), PDFName);
    if (actionType === PDFName.of("JavaScript")) {
      acc.javascript = true;
    }
    if (actionType === PDFName.of("URI") && object.has(PDFName.of("URI"))) {
      acc.externalUriCount += 1;
    }
    // Any dict literally carrying a /JS entry (e.g. a JavaScript action dict
    // without /S, or a name-tree leaf) also counts.
    if (object.has(PDFName.of("JS"))) {
      acc.javascript = true;
    }

    for (const [, value] of object.entries()) {
      if (value instanceof PDFDict || value instanceof PDFArray) {
        walkForRiskFlags(value, acc, depth + 1);
      }
    }
  } else if (object instanceof PDFArray) {
    for (let i = 0; i < object.size(); i++) {
      const value = object.get(i);
      if (value instanceof PDFDict || value instanceof PDFArray) {
        walkForRiskFlags(value, acc, depth + 1);
      }
    }
  }
}

/**
 * Scans every indirect object in the document (and their inline sub-
 * structure, e.g. a Link annotation's /A action) for risk indicators. We
 * never execute any of these — this is detection-only, surfaced as warnings
 * (PDF_CONTAINS_JAVASCRIPT / PDF_CONTAINS_EMBEDDED_FILES /
 * PDF_CONTAINS_EXTERNAL_URIS / PDF_HAS_OPEN_ACTION) by injectPdf/callers.
 * Round 2 §0.1.
 */
export function detectRiskFlags(doc: PDFDocument): SourceRiskFlags {
  const catalog = doc.catalog;
  const openAction = catalog.has(PDFName.of("OpenAction"));

  const acc: RiskFlagAccumulator = { javascript: false, embeddedFiles: false, externalUriCount: 0 };

  const namesDict = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const jsNameTree = namesDict?.lookupMaybe(PDFName.of("JavaScript"), PDFDict);
  if (jsNameTree?.lookupMaybe(PDFName.of("Names"), PDFArray)) {
    acc.javascript = true;
  }
  const embeddedFilesTree = namesDict?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (embeddedFilesTree?.lookupMaybe(PDFName.of("Names"), PDFArray)) {
    acc.embeddedFiles = true;
  }

  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    walkForRiskFlags(object, acc, 0);
  }

  return {
    javascript: acc.javascript,
    embeddedFiles: acc.embeddedFiles,
    externalUriCount: acc.externalUriCount,
    openAction,
  };
}

/**
 * Inspects a source PDF: magic bytes, parseability, encryption, signature
 * presence, page count/geometry. Throws typed PdfEngineError subclasses
 * (InvalidPdfError / PdfEncryptedError / PdfSignedError / TooManyPagesError)
 * that callers map 1:1 to ApiErrorCode. PRD §13.1.
 */
export async function inspectSource(input: InspectSourceInput): Promise<SourceInspection> {
  const { bytes, filename } = input;
  const maxPages = input.maxPages ?? LIMITS.maxPages;
  const maxPageDimensionPt = input.maxPageDimensionPt ?? LIMITS.maxPageDimensionPt;

  if (!hasPdfMagicBytes(bytes)) {
    throw new InvalidPdfError("File does not start with the %PDF- magic bytes");
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (err) {
    throw new InvalidPdfError(`Failed to parse PDF: ${(err as Error).message}`);
  }

  if (doc.isEncrypted) {
    throw new PdfEncryptedError("Source PDF is encrypted");
  }

  if (isSignedDocument(doc)) {
    throw new PdfSignedError(
      "Source PDF contains a digital signature (AcroForm /FT /Sig or /Perms)",
    );
  }

  const pageCount = doc.getPageCount();
  if (pageCount > maxPages) {
    throw new TooManyPagesError(`Document has ${pageCount} pages, limit is ${maxPages}`);
  }

  const pages = snapshotPageGeometry(doc);

  for (const page of pages) {
    const maxDim = Math.max(
      page.mediaBox[2] - page.mediaBox[0],
      page.mediaBox[3] - page.mediaBox[1],
    );
    if (maxDim > maxPageDimensionPt) {
      throw new InvalidPdfError(
        `Page ${page.pageIndex} has an abnormal dimension (${maxDim}pt exceeds the ${maxPageDimensionPt}pt limit)`,
      );
    }
  }

  return {
    filename,
    sizeBytes: bytes.byteLength,
    sha256: sha256Hex(bytes),
    pageCount,
    encrypted: false,
    signed: false,
    pdfVersion: extractPdfVersion(bytes),
    pages,
    riskFlags: detectRiskFlags(doc),
  };
}
