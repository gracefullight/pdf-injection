import { describe, expect, test } from "bun:test";
import { ERROR_MESSAGES, ERROR_STATUS } from "../src/error-codes";
import type { ApiErrorCode } from "../src/types";

const ALL_CODES: ApiErrorCode[] = [
  "INVALID_PDF",
  "PDF_ENCRYPTED",
  "PDF_SIGNED",
  "FILE_TOO_LARGE",
  "TOO_MANY_PAGES",
  "PROMPT_TOO_LONG",
  "PROMPT_ENCODING_FAILED",
  "PROMPT_LINT_ERROR",
  "VALIDATION_ERROR",
  "INJECTION_FAILED",
  "OUTPUT_PARSE_FAILED",
  "GEOMETRY_CHANGED",
  "RENDER_FAILED",
  "JOB_NOT_FOUND",
  "JOB_FORBIDDEN",
  "JOB_NOT_READY",
  "NOT_IMPLEMENTED",
  "EXTERNAL_PROVIDERS_DISABLED",
  "RESEARCH_MODE_DISABLED",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_ERROR",
  "RUN_NOT_FOUND",
  "SUBMISSION_NOT_FOUND",
  "VARIANT_SET_NOT_FOUND",
  "TOO_MANY_VARIANTS",
  "TOO_MANY_STUDENTS",
  "OCR_UNAVAILABLE",
  "CANVAS_UNAVAILABLE",
  "PROCESSING_TIMEOUT",
  "FONT_UNAVAILABLE",
  "RUN_NOT_READY",
  "UNSUPPORTED_MEDIA_TYPE",
];

describe("ERROR_MESSAGES", () => {
  test("every ApiErrorCode has an en and ko message", () => {
    for (const code of ALL_CODES) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(ERROR_MESSAGES[code].en.length).toBeGreaterThan(0);
      expect(ERROR_MESSAGES[code].ko.length).toBeGreaterThan(0);
    }
  });

  test("PDF_ENCRYPTED ko message matches PRD §24", () => {
    expect(ERROR_MESSAGES.PDF_ENCRYPTED.ko).toBe("암호화된 PDF는 현재 지원하지 않습니다.");
  });

  test("GEOMETRY_CHANGED ko message matches PRD §24", () => {
    expect(ERROR_MESSAGES.GEOMETRY_CHANGED.ko).toBe(
      "페이지 구조가 변경돼 결과를 제공하지 않습니다.",
    );
  });
});

describe("ERROR_STATUS", () => {
  test("maps error codes to their HTTP status per API contract", () => {
    expect(ERROR_STATUS.INVALID_PDF).toBe(400);
    expect(ERROR_STATUS.PDF_ENCRYPTED).toBe(422);
    expect(ERROR_STATUS.FILE_TOO_LARGE).toBe(413);
    expect(ERROR_STATUS.JOB_FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.JOB_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.JOB_NOT_READY).toBe(409);
    expect(ERROR_STATUS.NOT_IMPLEMENTED).toBe(501);
  });

  test("every ApiErrorCode has an HTTP status", () => {
    for (const code of ALL_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  test("round 2 error codes map to the status codes in the phase3-5 API contract", () => {
    expect(ERROR_STATUS.EXTERNAL_PROVIDERS_DISABLED).toBe(403);
    expect(ERROR_STATUS.RESEARCH_MODE_DISABLED).toBe(403);
    expect(ERROR_STATUS.PROVIDER_NOT_CONFIGURED).toBe(422);
    expect(ERROR_STATUS.PROVIDER_ERROR).toBe(502);
    expect(ERROR_STATUS.RUN_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.SUBMISSION_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.VARIANT_SET_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.TOO_MANY_VARIANTS).toBe(422);
    expect(ERROR_STATUS.TOO_MANY_STUDENTS).toBe(422);
    expect(ERROR_STATUS.OCR_UNAVAILABLE).toBe(422);
    expect(ERROR_STATUS.CANVAS_UNAVAILABLE).toBe(422);
    expect(ERROR_STATUS.PROCESSING_TIMEOUT).toBe(504);
    expect(ERROR_STATUS.FONT_UNAVAILABLE).toBe(422);
    expect(ERROR_STATUS.RUN_NOT_READY).toBe(409);
    expect(ERROR_STATUS.UNSUPPORTED_MEDIA_TYPE).toBe(415);
  });
});
