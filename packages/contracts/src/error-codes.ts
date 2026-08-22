import type { ApiErrorCode } from "./types";

export interface LocalizedMessage {
  en: string;
  ko: string;
}

/**
 * User-facing messages per ApiErrorCode.
 * `ko` text is copied verbatim from PRD §24 where the code appears there;
 * codes added only in the API contract (PROMPT_LINT_ERROR, VALIDATION_ERROR,
 * JOB_NOT_FOUND, JOB_FORBIDDEN, JOB_NOT_READY, NOT_IMPLEMENTED) get an
 * equivalent message in the same style.
 */
export const ERROR_MESSAGES: Record<ApiErrorCode, LocalizedMessage> = {
  INVALID_PDF: {
    en: "Please upload a valid PDF file.",
    ko: "유효한 PDF 파일을 업로드해 주세요.",
  },
  PDF_ENCRYPTED: {
    en: "Encrypted PDFs are not supported yet.",
    ko: "암호화된 PDF는 현재 지원하지 않습니다.",
  },
  PDF_SIGNED: {
    en: "This PDF cannot be modified because it would invalidate its digital signature.",
    ko: "서명을 무효화할 수 있어 수정할 수 없습니다.",
  },
  FILE_TOO_LARGE: {
    en: "The file exceeds the allowed size limit.",
    ko: "허용된 파일 크기를 초과했습니다.",
  },
  TOO_MANY_PAGES: {
    en: "The document exceeds the allowed page limit.",
    ko: "허용된 페이지 수를 초과했습니다.",
  },
  PROMPT_TOO_LONG: {
    en: "Please shorten the hidden instruction.",
    ko: "Hidden instruction 길이를 줄여 주세요.",
  },
  PROMPT_ENCODING_FAILED: {
    en: "Please rewrite the instruction using supported characters.",
    ko: "지원되는 문자로 instruction을 수정해 주세요.",
  },
  PROMPT_LINT_ERROR: {
    en: "The hidden instruction failed validation. Please review and fix the reported issues.",
    ko: "Hidden instruction 검증에 실패했습니다. 안내된 문제를 수정해 주세요.",
  },
  VALIDATION_ERROR: {
    en: "The request contains invalid or missing fields.",
    ko: "요청에 유효하지 않거나 누락된 값이 있습니다.",
  },
  INJECTION_FAILED: {
    en: "Could not process the selected PDF or injection mode.",
    ko: "선택한 PDF 또는 injection mode를 처리하지 못했습니다.",
  },
  OUTPUT_PARSE_FAILED: {
    en: "Validation of the generated PDF failed.",
    ko: "생성된 PDF 검증에 실패했습니다.",
  },
  GEOMETRY_CHANGED: {
    en: "The page structure changed, so the result cannot be provided.",
    ko: "페이지 구조가 변경돼 결과를 제공하지 않습니다.",
  },
  RENDER_FAILED: {
    en: "The generated PDF could not be rendered correctly.",
    ko: "생성된 PDF를 정상적으로 표시할 수 없습니다.",
  },
  JOB_NOT_FOUND: {
    en: "This job does not exist or has expired.",
    ko: "존재하지 않거나 만료된 작업입니다.",
  },
  JOB_FORBIDDEN: {
    en: "Missing or invalid access token for this job.",
    ko: "이 작업에 대한 접근 토큰이 없거나 올바르지 않습니다.",
  },
  JOB_NOT_READY: {
    en: "This artifact is not ready yet.",
    ko: "아직 준비되지 않은 결과물입니다.",
  },
  NOT_IMPLEMENTED: {
    en: "Provider benchmark is a Phase 2 feature and is disabled by default.",
    ko: "Provider benchmark는 Phase 2 기능이며 기본적으로 비활성화돼 있습니다.",
  },
  EXTERNAL_PROVIDERS_DISABLED: {
    en: "External model providers are disabled on this server. Set PDFI_ALLOW_EXTERNAL_PROVIDERS=true to enable them.",
    ko: "이 서버에서는 외부 모델 provider가 비활성화돼 있습니다. 활성화하려면 PDFI_ALLOW_EXTERNAL_PROVIDERS=true로 설정하세요.",
  },
  RESEARCH_MODE_DISABLED: {
    en: "Research-mode features (submissions, robustness) are disabled on this server. Set PDFI_RESEARCH_MODE=true to enable them.",
    ko: "연구용 기능(submissions, robustness)이 이 서버에서 비활성화돼 있습니다. 활성화하려면 PDFI_RESEARCH_MODE=true로 설정하세요.",
  },
  PROVIDER_NOT_CONFIGURED: {
    en: "The selected provider is missing an API key on this server.",
    ko: "선택한 provider에 대한 API 키가 서버에 설정돼 있지 않습니다.",
  },
  PROVIDER_ERROR: {
    en: "The model provider returned an error. Please try again.",
    ko: "모델 provider에서 오류가 반환됐습니다. 다시 시도해 주세요.",
  },
  RUN_NOT_FOUND: {
    en: "This run does not exist or has expired.",
    ko: "존재하지 않거나 만료된 run입니다.",
  },
  SUBMISSION_NOT_FOUND: {
    en: "This submission does not exist or has expired.",
    ko: "존재하지 않거나 만료된 submission입니다.",
  },
  VARIANT_SET_NOT_FOUND: {
    en: "This variant set does not exist or has expired.",
    ko: "존재하지 않거나 만료된 variant set입니다.",
  },
  TOO_MANY_VARIANTS: {
    en: "The number of variants exceeds the allowed limit.",
    ko: "허용된 variant 개수를 초과했습니다.",
  },
  TOO_MANY_STUDENTS: {
    en: "The number of students exceeds the allowed limit.",
    ko: "허용된 학생 수를 초과했습니다.",
  },
  OCR_UNAVAILABLE: {
    en: "OCR is not available on this server.",
    ko: "이 서버에서는 OCR을 사용할 수 없습니다.",
  },
  CANVAS_UNAVAILABLE: {
    en: "PDF rendering (canvas) is not available on this server.",
    ko: "이 서버에서는 PDF 렌더링(canvas)을 사용할 수 없습니다.",
  },
  PROCESSING_TIMEOUT: {
    en: "Processing took too long and was aborted.",
    ko: "처리 시간이 초과돼 중단됐습니다.",
  },
  FONT_UNAVAILABLE: {
    en: "The font required for this payload language is not available on this server.",
    ko: "이 payload 언어에 필요한 폰트를 서버에서 사용할 수 없습니다.",
  },
  RUN_NOT_READY: {
    en: "This run is not finished yet.",
    ko: "아직 완료되지 않은 run입니다.",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    en: "This file type is not supported.",
    ko: "지원하지 않는 파일 형식입니다.",
  },
};

/** HTTP status code per ApiErrorCode, per the API contract's error table. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_PDF: 400,
  PDF_ENCRYPTED: 422,
  PDF_SIGNED: 422,
  FILE_TOO_LARGE: 413,
  TOO_MANY_PAGES: 422,
  PROMPT_TOO_LONG: 422,
  PROMPT_ENCODING_FAILED: 422,
  PROMPT_LINT_ERROR: 422,
  VALIDATION_ERROR: 422,
  INJECTION_FAILED: 500,
  OUTPUT_PARSE_FAILED: 500,
  GEOMETRY_CHANGED: 422,
  RENDER_FAILED: 422,
  JOB_NOT_FOUND: 404,
  JOB_FORBIDDEN: 403,
  JOB_NOT_READY: 409,
  NOT_IMPLEMENTED: 501,
  EXTERNAL_PROVIDERS_DISABLED: 403,
  RESEARCH_MODE_DISABLED: 403,
  PROVIDER_NOT_CONFIGURED: 422,
  PROVIDER_ERROR: 502,
  RUN_NOT_FOUND: 404,
  SUBMISSION_NOT_FOUND: 404,
  VARIANT_SET_NOT_FOUND: 404,
  TOO_MANY_VARIANTS: 422,
  TOO_MANY_STUDENTS: 422,
  OCR_UNAVAILABLE: 422,
  CANVAS_UNAVAILABLE: 422,
  PROCESSING_TIMEOUT: 504,
  FONT_UNAVAILABLE: 422,
  RUN_NOT_READY: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
};
