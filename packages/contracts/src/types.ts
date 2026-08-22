// Wire types shared between apps/api and apps/web.
// Source: .agents/results/api-contracts/pdf-injection-jobs-api.md ("Data Models" section)

export type InjectionMode =
  | "white_text"
  | "render_mode_3"
  | "visible_positive_control"
  | "xmp_only";

/**
 * Payload language for the hidden instruction. `"en"` is printable-ASCII only
 * (existing v0.1 behavior); `"ko"` allows non-ASCII text and requires a CJK
 * font subset (embedded via @pdf-lib/fontkit in packages/pdf-engine).
 */
export type PayloadLanguage = "en" | "ko";

/** Round 2 cross-cutting unions — see .agents/results/api-contracts/pdf-injection-phase3-5-api.md §0.1 */
export type BenchmarkCondition = "original" | InjectionMode;
/** "mock" is a deterministic local fallback and is always available (no API key needed). */
export type ProviderName = "anthropic" | "openai" | "mock";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
/** "baseline" = known-original (non-injected) responses/answers used for false-positive calibration. */
export type SubmissionLabel = "candidate" | "baseline";
export type PdfTransform = "print_to_pdf" | "ocr_regeneration" | "screenshot_ocr";
export type TextTransform = "paraphrase" | "translation" | "human_edit";
export type DistributionStrategy = "round_robin" | "seeded_hash";

/** number is 1-based from the API; resolved to a 0-based pageIndex internally. */
export type TargetPage = number | "first" | "last";

export type Position = "top" | "bottom" | "custom";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type OverallStatus = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "NOT_TESTED";

export type QpdfStatus = "not_run" | "passed" | "warning" | "failed";

export type ExpectedSignal =
  | { type: "exact_phrase"; value: string; caseSensitive: boolean }
  | { type: "regex"; pattern: string; flags: string }
  | { type: "methodology_label"; value: string; aliases: string[] }
  | { type: "ordered_terms"; values: string[] }
  | { type: "section_order"; values: string[] };

export interface PageGeometry {
  pageIndex: number;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotation: number;
  width: number;
  height: number;
}

export interface ValidationWarning {
  code: string;
  message: string;
  pageIndex?: number;
}

export interface LintIssue {
  id: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidationSummary {
  outputLoadPassed: boolean;
  pdfJsRenderPassed: boolean | null; // null until client validation posted
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  hiddenTextExtracted: boolean; // server-side pdfjs-dist getTextContent on target page
  changedPixelRatio: number | null; // null until client validation posted
  qpdfStatus: QpdfStatus;
  /**
   * Whether the XMP /Metadata payload (pdf-injection:instruction) is present.
   * `null` for every mode except "xmp_only", where it must be `true` or
   * overall = FAIL. See computeOverall().
   */
  metadataPayloadPresent: boolean | null;
  overall: OverallStatus;
}

export interface JobRecord {
  id: string;
  status: JobStatus;
  sourceFilename: string;
  sourceSha256: string;
  outputSha256: string | null;
  promptSha256: string;
  injectionMode: InjectionMode;
  targetPage: number; // resolved 0-based index
  createdAt: string;
  expiresAt: string;
  errorCode: string | null;
}
// SQLite never stores the instruction text. Prompt text exists only inside the manifest artifact file.

/**
 * Risk flags detected in a source PDF. We never execute any of these — they
 * are surfaced as warnings only (PDF_CONTAINS_JAVASCRIPT,
 * PDF_CONTAINS_EMBEDDED_FILES, PDF_CONTAINS_EXTERNAL_URIS, PDF_HAS_OPEN_ACTION).
 */
export interface SourceRiskFlags {
  javascript: boolean;
  embeddedFiles: boolean;
  externalUriCount: number;
  openAction: boolean;
}

export interface SourceInspection {
  filename: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  encrypted: boolean;
  signed: boolean;
  pdfVersion: string | null;
  pages: PageGeometry[];
  riskFlags: SourceRiskFlags;
}

export interface PrivateManifest {
  schemaVersion: "0.2";
  jobId: string;
  sourceFile: { name: string; sha256: string; sizeBytes: number };
  outputFile: { name: string; sha256: string; sizeBytes: number };
  prompt: {
    sha256: string;
    instruction: string;
    normalizedInstruction: string;
    language: PayloadLanguage;
    length: number;
  };
  expectedSignals: ExpectedSignal[];
  injection: {
    mode: InjectionMode;
    pageIndex: number;
    position: Position;
    fontSize: number;
    boundingBox: [number, number, number, number];
  };
  validation: ValidationSummary;
  toolVersions: {
    bun: string;
    pdfLib: string;
    pdfJs: string;
    qpdf: string | null;
    pdf-injection: string;
  };
  createdAt: string;
  warning: "PRIVATE — contains the hidden instruction. Do not distribute to students.";
}

export interface ValidationReport {
  schemaVersion: "0.2";
  jobId: string;
  createdAt: string;
  updatedAt: string;
  source: SourceInspection;
  output: {
    sha256: string;
    sizeBytes: number;
    pageCount: number;
    pages: PageGeometry[];
    fileSizeDelta: number;
  };
  injection: PrivateManifest["injection"];
  serverValidation: {
    outputLoad: { passed: boolean; error?: string };
    pageCount: { passed: boolean; before: number; after: number };
    geometry: {
      passed: boolean;
      mismatches: Array<{ pageIndex: number; field: string; before: unknown; after: unknown }>;
    };
    textExtraction: {
      // server-side pdfjs-dist legacy build
      pdfJsVersion: string;
      pages: Array<{
        pageIndex: number;
        textLength: number;
        exactMatch: boolean;
        normalizedMatch: boolean;
        caseInsensitiveMatch: boolean;
        matchOffset: number | null;
      }>;
      targetPageMatch: boolean;
      anyPageMatch: boolean;
    };
    qpdf: {
      status: QpdfStatus;
      exitCode: number | null;
      stdout: string;
      stderr: string;
      warningCount: number;
      errorCount: number;
    } | null;
    /** XMP /Metadata inspection (packages/validation metadata-check.ts). */
    metadata: { xmpPresent: boolean; payloadFound: boolean; sha256OfPayload: string | null };
    warnings: ValidationWarning[]; // e.g. BACKGROUND_NOT_WHITE, ACCESSIBILITY_HIDDEN_TEXT
  };
  clientValidation: ClientValidationInput | null;
  summary: ValidationSummary;
  lint: { errors: LintIssue[]; warnings: LintIssue[]; acknowledged: string[] };
  disclaimer: "PDF.js parser view — may differ from actual LLM provider ingestion.";
}

export interface ClientValidationInput {
  pdfJsVersion: string;
  renderPassed: boolean;
  renderErrors: string[];
  visualDiff: {
    scale: number;
    thresholdRatio: number;
    pages: Array<{
      pageIndex: number;
      width: number;
      height: number;
      changedPixels: number;
      changedPixelRatio: number;
      maxChannelDelta: number;
      meanAbsoluteDifference: number;
      passed: boolean;
    }>;
    changedPixelRatio: number;
    passed: boolean;
  };
  extractedText: {
    pages: Array<{
      pageIndex: number;
      textLength: number;
      exactMatch: boolean;
      normalizedMatch: boolean;
      caseInsensitiveMatch: boolean;
      matchOffset: number | null;
    }>;
    targetPageMatch: boolean;
    anyPageMatch: boolean;
  };
}

export interface CreateJobResponse {
  jobId: string;
  accessToken: string;
  status: JobStatus;
  errorCode: string | null;
  lintWarnings: LintIssue[];
}

/** `GET /api/v1/health` response. Round 2 §0.2. */
export interface HealthResponse {
  status: "ok";
  version: string;
  qpdfAvailable: boolean;
  features: {
    externalProviders: boolean;
    researchMode: boolean;
    ocrAvailable: boolean;
    canvasAvailable: boolean;
    koPayload: boolean;
  };
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  errorCode: string | null;
  sourceFilename: string;
  injectionMode: InjectionMode;
  targetPage: number;
  createdAt: string;
  expiresAt: string;
  summary: ValidationSummary | null;
  artifacts: { outputPdf: boolean; privateManifest: boolean; validationReport: boolean };
}

export type ApiErrorCode =
  | "INVALID_PDF"
  | "PDF_ENCRYPTED"
  | "PDF_SIGNED"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_PAGES"
  | "PROMPT_TOO_LONG"
  | "PROMPT_ENCODING_FAILED"
  | "PROMPT_LINT_ERROR"
  | "VALIDATION_ERROR"
  | "INJECTION_FAILED"
  | "OUTPUT_PARSE_FAILED"
  | "GEOMETRY_CHANGED"
  | "RENDER_FAILED"
  | "JOB_NOT_FOUND"
  | "JOB_FORBIDDEN"
  | "JOB_NOT_READY"
  | "NOT_IMPLEMENTED"
  | "EXTERNAL_PROVIDERS_DISABLED"
  | "RESEARCH_MODE_DISABLED"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_ERROR"
  | "RUN_NOT_FOUND"
  | "SUBMISSION_NOT_FOUND"
  | "VARIANT_SET_NOT_FOUND"
  | "TOO_MANY_VARIANTS"
  | "TOO_MANY_STUDENTS"
  | "OCR_UNAVAILABLE"
  | "CANVAS_UNAVAILABLE"
  | "PROCESSING_TIMEOUT"
  | "FONT_UNAVAILABLE"
  | "RUN_NOT_READY"
  | "UNSUPPORTED_MEDIA_TYPE";

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: Record<string, unknown> };
}

/** Input to the PDF injection engine (packages/pdf-engine). PRD §10.1 */
export interface InjectPdfInput {
  source: Uint8Array;
  instruction: string;
  mode: InjectionMode;
  targetPage: TargetPage;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  /** default "en" (printable ASCII only). "ko" allows non-ASCII + requires a CJK font subset. */
  payloadLanguage?: PayloadLanguage;
}

/** Output of the PDF injection engine. PRD §10.2 */
export interface InjectPdfResult {
  bytes: Uint8Array;
  sourceSha256: string;
  outputSha256: string;
  promptSha256: string;
  pageIndex: number;
  pageGeometryBefore: PageGeometry[];
  pageGeometryAfter: PageGeometry[];
  warnings: ValidationWarning[];
  boundingBox: [number, number, number, number];
  fontSize: number;
}
