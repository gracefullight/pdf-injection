import { type ApiErrorCode, ERROR_MESSAGES, ERROR_STATUS } from "@pdf-injection/contracts";

/**
 * Centralized API error. Every intentionally-thrown rejection in apps/api
 * uses this class so the global error mapper (middleware/error-mapper.ts)
 * can turn it into the contract's error envelope + HTTP status in one place.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? ERROR_MESSAGES[code].en);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  toResponseBody(): {
    error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
  } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
