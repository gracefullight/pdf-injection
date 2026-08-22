import { ERROR_MESSAGES, ERROR_STATUS } from "@pdf-injection/contracts";
import { PdfEngineError } from "@pdf-injection/pdf-engine";
import { ApiError } from "../errors";

export interface MappedError {
  status: number;
  body: { error: { code: string; message: string; details?: Record<string, unknown> } };
}

/**
 * Centralized error -> response mapping. Handles typed ApiError and
 * PdfEngineError subclasses (which already carry an ApiErrorCode), maps
 * Elysia's own validation failures to 422 VALIDATION_ERROR, and falls back
 * to a generic 500 that never leaks internal error details/stack traces.
 */
export function mapError(error: unknown, elysiaCode?: string | number): MappedError {
  if (error instanceof ApiError) {
    return { status: error.status, body: error.toResponseBody() };
  }

  if (error instanceof PdfEngineError) {
    const status = ERROR_STATUS[error.code];
    const message = error.message || ERROR_MESSAGES[error.code].en;
    return { status, body: { error: { code: error.code, message } } };
  }

  if (elysiaCode === "VALIDATION") {
    return {
      status: 422,
      body: { error: { code: "VALIDATION_ERROR", message: ERROR_MESSAGES.VALIDATION_ERROR.en } },
    };
  }

  if (elysiaCode === "PARSE") {
    return {
      status: 422,
      body: { error: { code: "VALIDATION_ERROR", message: ERROR_MESSAGES.VALIDATION_ERROR.en } },
    };
  }

  if (elysiaCode === "NOT_FOUND") {
    // Genuinely unmatched route/method (not a job lookup) — plain 404, not
    // the job-specific JOB_NOT_FOUND ApiErrorCode.
    return {
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "Not Found" } },
    };
  }

  // Unknown error: never leak internals (stack traces, file paths, etc).
  // Not part of the closed ApiErrorCode union — this is a defensive
  // catch-all for genuinely unexpected failures.
  return {
    status: 500,
    body: { error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } },
  };
}
