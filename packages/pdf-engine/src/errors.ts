import type { ApiErrorCode } from "@pdf-injection/contracts";

/** Base class for all pdf-engine errors; carries the ApiErrorCode the caller should map to. */
export class PdfEngineError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = "PdfEngineError";
    this.code = code;
  }
}

export class InvalidPdfError extends PdfEngineError {
  constructor(message: string) {
    super("INVALID_PDF", message);
    this.name = "InvalidPdfError";
  }
}

export class PdfEncryptedError extends PdfEngineError {
  constructor(message: string) {
    super("PDF_ENCRYPTED", message);
    this.name = "PdfEncryptedError";
  }
}

export class PdfSignedError extends PdfEngineError {
  constructor(message: string) {
    super("PDF_SIGNED", message);
    this.name = "PdfSignedError";
  }
}

export class TooManyPagesError extends PdfEngineError {
  constructor(message: string) {
    super("TOO_MANY_PAGES", message);
    this.name = "TooManyPagesError";
  }
}

export class InjectionFailedError extends PdfEngineError {
  constructor(message: string) {
    super("INJECTION_FAILED", message);
    this.name = "InjectionFailedError";
  }
}

export class OutputParseFailedError extends PdfEngineError {
  constructor(message: string) {
    super("OUTPUT_PARSE_FAILED", message);
    this.name = "OutputParseFailedError";
  }
}

export class GeometryChangedError extends PdfEngineError {
  constructor(message: string) {
    super("GEOMETRY_CHANGED", message);
    this.name = "GeometryChangedError";
  }
}

export class PromptEncodingFailedError extends PdfEngineError {
  constructor(message: string) {
    super("PROMPT_ENCODING_FAILED", message);
    this.name = "PromptEncodingFailedError";
  }
}

/**
 * Malformed/out-of-range caller input that isn't specific to any other
 * PdfEngineError subclass — e.g. an out-of-range `targetPage`, or a missing
 * `x`/`y` when `position` is `"custom"`. Maps to ApiErrorCode VALIDATION_ERROR
 * (422), matching the API contract's "malformed field" bucket.
 */
export class ValidationError extends PdfEngineError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

/**
 * Non-ASCII instruction requested with payloadLanguage "ko" but the CJK font
 * subset (Noto Sans KR) is not available on this server (missing font file,
 * PDFI_FONT_DIR misconfigured, or fontkit embedding failed). Round 2 §0.1.
 */
export class FontUnavailableError extends PdfEngineError {
  constructor(message: string) {
    super("FONT_UNAVAILABLE", message);
    this.name = "FontUnavailableError";
  }
}
