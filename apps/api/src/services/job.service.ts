import {
  type ClientValidationInput,
  type ExpectedSignal,
  type InjectionMode,
  isExpectedSignal,
  type JobStatus,
  type JobStatusResponse,
  type LintIssue,
  type PayloadLanguage,
  type Position,
  type PrivateManifest,
  type TargetPage,
  type ValidationReport,
  type ValidationWarning,
} from "@pdf-injection/contracts";
import {
  buildManifest,
  compareGeometry,
  InjectionFailedError,
  injectPdf,
  inspectSource,
  normalizePrompt,
  PdfEngineError,
  readAcroFormFieldPayload,
  readFreetextAnnotPayload,
  readInfoDictPayload,
  readStampedImagePresence,
  readUnicodeTagsPayload,
  resolveTargetPages,
} from "@pdf-injection/pdf-engine";
import { lintPrompt } from "@pdf-injection/prompt-lint";
import {
  buildReport,
  buildSummary,
  checkMetadataPayload,
  extractText,
  mergeClientValidation,
  qpdfCheck,
  sha256Hex,
} from "@pdf-injection/validation";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { withTimeLimit } from "../lib/time-limit";
import { generateAccessToken, hashAccessToken } from "../middleware/access-token";
import type { JobsRepository, StoredJobRow } from "../repositories/jobs.repository";
import {
  deleteJobDir,
  isValidJobId,
  jobFileExists,
  jobFilePath,
  readJobFileText,
  sanitizeFilenameStem,
  writeJobFile,
} from "../storage";

export interface JobServiceDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
}

export interface CreateJobFields {
  file: File;
  instruction: string;
  expectedSignalsJson: string;
  injectionMode: string;
  targetPageRaw: string | null;
  positionRaw: string | null;
  xRaw: string | null;
  yRaw: string | null;
  fontSizeRaw: string | null;
  maxWidthRaw: string | null;
  acknowledgedWarningsRaw: string | null;
  /** Round 2 §0.1/§0.3 — "en" (default), "ko", or "zh"; ko/zh allow non-ASCII + require a CJK font subset. */
  payloadLanguageRaw: string | null;
}

export interface CreateJobResult {
  jobId: string;
  accessToken: string;
  status: JobStatus;
  errorCode: string | null;
  lintWarnings: LintIssue[];
}

const INJECTION_MODES: InjectionMode[] = [
  "white_text",
  "render_mode_3",
  "visible_positive_control",
  "xmp_only",
  "unicode_tags",
  // Round-3 research/diagnostic probe conditions (not production channels) —
  // see packages/pdf-engine's inject-{image-only,freetext-annot,acroform-field,info-dict}.ts.
  "image_only",
  "freetext_annot",
  "acroform_field",
  "info_dict",
];
const POSITIONS: Position[] = ["top", "bottom", "custom"];
const PAYLOAD_LANGUAGES: PayloadLanguage[] = ["en", "ko", "zh"];

function parseInjectionMode(raw: string): InjectionMode {
  if (!INJECTION_MODES.includes(raw as InjectionMode)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `injectionMode must be one of ${INJECTION_MODES.join(", ")}`,
    );
  }
  return raw as InjectionMode;
}

function parsePayloadLanguage(raw: string | null): PayloadLanguage {
  if (raw === null || raw === "") return "en";
  if (!PAYLOAD_LANGUAGES.includes(raw as PayloadLanguage)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `payloadLanguage must be one of ${PAYLOAD_LANGUAGES.join(", ")}`,
    );
  }
  return raw as PayloadLanguage;
}

function parsePosition(raw: string | null): Position {
  if (raw === null || raw === "") return "bottom";
  if (!POSITIONS.includes(raw as Position)) {
    throw new ApiError("VALIDATION_ERROR", `position must be one of ${POSITIONS.join(", ")}`);
  }
  return raw as Position;
}

function parseTargetPage(raw: string | null): TargetPage {
  if (raw === null || raw === "" || raw === "last") return "last";
  if (raw === "first") return "first";
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `targetPage must be "first", "last", "all", or a positive integer, got "${raw}"`,
    );
  }
  return n;
}

function parseOptionalNumber(raw: string | null, field: string): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApiError("VALIDATION_ERROR", `${field} must be a number, got "${raw}"`);
  }
  return n;
}

function parseAcknowledgedWarnings(raw: string | null): string[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "acknowledgedWarnings is not valid JSON");
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new ApiError("VALIDATION_ERROR", "acknowledgedWarnings must be a JSON array of strings");
  }
  return parsed;
}

/**
 * Parses the `expectedSignals` multipart field. Malformed JSON or a shape
 * that doesn't match ExpectedSignal[] is a VALIDATION_ERROR (contract:
 * "malformed multipart field / JSON"). An empty array is valid: expected
 * signals are optional at generation time; the scoring endpoints are what
 * require them — see lib/expected-signals.ts.
 */
function parseExpectedSignalsField(raw: string): ExpectedSignal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "expectedSignals is not valid JSON");
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => isExpectedSignal(item))) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "expectedSignals does not match ExpectedSignal[] schema",
    );
  }
  return parsed;
}

/** Maps a lintPrompt() error id to the specific ApiErrorCode the contract requires. */
function lintErrorsToApiError(errors: LintIssue[]): ApiError {
  if (errors.some((e) => e.id === "prompt_too_long")) {
    return new ApiError("PROMPT_TOO_LONG", undefined, { lintErrors: errors });
  }
  if (
    errors.some(
      (e) =>
        e.id === "null_byte" || e.id === "control_character" || e.id === "encoding_unsupported",
    )
  ) {
    return new ApiError("PROMPT_ENCODING_FAILED", undefined, { lintErrors: errors });
  }
  return new ApiError("PROMPT_LINT_ERROR", undefined, { lintErrors: errors });
}

function toolVersions(deps: JobServiceDeps, pdfJsVersion: string, qpdfDetected: boolean) {
  return {
    bun: Bun.version,
    pdfLib: "1.17.1",
    pdfJs: pdfJsVersion,
    qpdf: deps.config.qpdfEnabled && qpdfDetected ? "detected" : null,
    pdfInjection: "0.1.0",
  };
}

/**
 * POST /api/v1/jobs business logic. Runs inspect -> lint -> inject ->
 * round-trip validate -> text-extract -> qpdf -> report -> manifest ->
 * persist, entirely synchronously. Pre-processing rejections (inspectSource
 * / lint / malformed fields) throw before any job row or file is created.
 * injectPdf() failures are "hard-gate" processing failures: a job row with
 * status "failed" + errorCode is still created (best-effort report/manifest,
 * no output.pdf), and the caller responds 201 per the API contract.
 */
export async function createJob(
  deps: JobServiceDeps,
  fields: CreateJobFields,
): Promise<CreateJobResult> {
  const { config, jobsRepo } = deps;

  const expectedSignals = parseExpectedSignalsField(fields.expectedSignalsJson);
  const injectionMode = parseInjectionMode(fields.injectionMode);
  const position = parsePosition(fields.positionRaw);
  const targetPageInput = parseTargetPage(fields.targetPageRaw);
  const x = parseOptionalNumber(fields.xRaw, "x");
  const y = parseOptionalNumber(fields.yRaw, "y");
  const fontSize = parseOptionalNumber(fields.fontSizeRaw, "fontSize");
  const maxWidth = parseOptionalNumber(fields.maxWidthRaw, "maxWidth");
  const acknowledgedWarnings = parseAcknowledgedWarnings(fields.acknowledgedWarningsRaw);
  const payloadLanguage = parsePayloadLanguage(fields.payloadLanguageRaw);

  if (position === "custom" && (x === undefined || y === undefined)) {
    throw new ApiError("VALIDATION_ERROR", "x and y are required when position is 'custom'");
  }

  // unicode_tags only carries ASCII payloads (its codec has no non-ASCII
  // encoding) — injectPdf() itself already enforces this (throws
  // PromptEncodingFailedError), but that's a hard-gate rejection (201, job
  // row persisted with status "failed") since it's structurally
  // indistinguishable there from a data-dependent runtime failure. This
  // combination is known/deterministic before any file bytes are even read,
  // so reject it here as a genuine pre-processing 422 (no job row, no
  // source.pdf persisted) — matching every other structurally-invalid
  // input-combination check in this function.
  if (injectionMode === "unicode_tags" && (payloadLanguage === "ko" || payloadLanguage === "zh")) {
    throw new ApiError(
      "PROMPT_ENCODING_FAILED",
      `injectionMode 'unicode_tags' only supports ASCII payloads; payloadLanguage '${payloadLanguage}' is not supported for this mode.`,
    );
  }

  const bytes = new Uint8Array(await fields.file.arrayBuffer());
  if (bytes.byteLength > config.maxFileBytes) {
    throw new ApiError("FILE_TOO_LARGE");
  }

  // Pre-processing: throws PdfEngineError subclasses (INVALID_PDF /
  // PDF_ENCRYPTED / PDF_SIGNED / TOO_MANY_PAGES). No job row created yet.
  const sourceInspection = await inspectSource({
    bytes,
    filename: fields.file.name,
    maxPages: config.maxPages,
    maxPageDimensionPt: config.maxPageDimensionPt,
  });

  const resolvedTargetPageIndexes = (() => {
    try {
      return resolveTargetPages(targetPageInput, sourceInspection.pageCount);
    } catch (err) {
      throw new ApiError("VALIDATION_ERROR", (err as Error).message);
    }
  })();
  const resolvedTargetPageIndex = resolvedTargetPageIndexes[0] as number;

  // Browser FormData normalizes textarea line endings to CRLF. Canonicalize
  // before linting so the transport's `\r` bytes are not mistaken for
  // unsupported control characters; injection and hashing use this same form.
  const normalizedInstruction = normalizePrompt(fields.instruction);
  const lint = lintPrompt(normalizedInstruction, expectedSignals, {
    maxLength: config.maxInstructionChars,
    payloadLanguage,
  });
  if (lint.errors.length > 0) {
    throw lintErrorsToApiError(lint.errors);
  }

  const jobId = crypto.randomUUID();
  const accessToken = generateAccessToken();
  const accessTokenHash = hashAccessToken(accessToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.retentionHours * 60 * 60 * 1000);
  const stem = sanitizeFilenameStem(fields.file.name);
  const promptSha256 = sha256Hex(normalizedInstruction);

  // Job row + source.pdf are always persisted from this point on, whether
  // injection ultimately succeeds or hits a hard gate.
  await writeJobFile(config, jobId, "source.pdf", bytes);

  const injectionInputCommon = {
    mode: injectionMode,
    pageIndex: resolvedTargetPageIndex,
    pageIndexes: resolvedTargetPageIndexes,
    position,
    fontSize: fontSize ?? 1,
    boundingBox: [0, 0, 0, 0] as [number, number, number, number],
  };

  // Processing (injectPdf -> round-trip validate -> extract -> qpdf ->
  // report -> manifest -> persist) is wrapped in PDFI_MAX_PROCESSING_MS. On
  // timeout, the outer catch below deletes the job dir (source.pdf was
  // already written above) and rethrows without a row ever having been
  // inserted -> "no row/files" per contract §0.3. The `signal.aborted`
  // checks inside the callback stop it from writing output.pdf/report/
  // manifest/inserting a row *after* the race has already been lost (a
  // slow injectPdf() call could otherwise still resolve and finish
  // persisting moments after the client already got a 504).
  try {
    return await withTimeLimit(async (signal) => {
      try {
        const result = await injectPdf({
          source: bytes,
          instruction: normalizedInstruction,
          mode: injectionMode,
          targetPage: targetPageInput,
          position,
          x,
          y,
          fontSize,
          maxWidth,
          payloadLanguage,
        });

        if (signal.aborted) {
          throw new ApiError("PROCESSING_TIMEOUT");
        }

        // unicode_tags-only sanity gate, run before anything else touches
        // result.bytes (pdf.js's getDocument({data}) below detaches its
        // ArrayBuffer — see the comment on outputSizeBytes further down;
        // this public-pdf-lib-API read-back must run first regardless).
        // Verifies the ToUnicode CMap rewrite actually took effect on the
        // final saved bytes via a channel pdfjs-dist's Cf-category filter
        // doesn't intercept (extractText() below can never see this
        // payload — see packages/pdf-engine/test/inject-unicode-tags.test.ts's
        // documented finding). This should never fire in practice (it would
        // mean injectPdf() reported success but silently produced no
        // payload); it exists as a hard gate against exactly that failure
        // mode, routed through the same PdfEngineError hard-gate pathway
        // (job row persisted as "failed", 201 response) every other
        // injection failure already uses.
        if (injectionMode === "unicode_tags") {
          const unicodeTagsPayload = await readUnicodeTagsPayload(result.bytes);
          if (unicodeTagsPayload.length === 0) {
            throw new InjectionFailedError(
              "unicode_tags injection reported success but no Unicode Tag payload could be read back from the output PDF",
            );
          }
        }

        // Round-3 probe-mode sanity gates — same purpose/pattern as the
        // unicode_tags gate above (injectPdf() reporting success but the
        // mode's own dedicated reader finding no payload would mean a
        // silent, undetected injection failure). Each reader is a
        // public-pdf-lib-API read-back, independent of extractText()/pdfjs.
        if (injectionMode === "info_dict") {
          const infoDictPayload = await readInfoDictPayload(result.bytes);
          if (!infoDictPayload.subject) {
            throw new InjectionFailedError(
              "info_dict injection reported success but no Subject payload could be read back from the output PDF's /Info dictionary",
            );
          }
        }
        // Every injected page is gated, not just the first: with
        // targetPage="all" a payload that silently failed to land on page 7
        // must not pass because page 1 is fine.
        if (injectionMode === "freetext_annot") {
          for (const pageIndex of result.pageIndexes) {
            const freetextAnnotPayload = await readFreetextAnnotPayload(result.bytes, pageIndex);
            if (!freetextAnnotPayload.contentsPresent) {
              throw new InjectionFailedError(
                `freetext_annot injection reported success but no FreeText annotation payload could be read back from page ${pageIndex + 1} of the output PDF`,
              );
            }
          }
        }
        if (injectionMode === "acroform_field") {
          const acroFormFieldPayload = await readAcroFormFieldPayload(result.bytes);
          if (!acroFormFieldPayload.fieldPresent) {
            throw new InjectionFailedError(
              "acroform_field injection reported success but no AcroForm field payload could be read back from the output PDF",
            );
          }
        }
        if (injectionMode === "image_only") {
          for (const pageIndex of result.pageIndexes) {
            const stampedImagePresence = await readStampedImagePresence(result.bytes, pageIndex);
            if (!stampedImagePresence.imagePresent) {
              throw new InjectionFailedError(
                `image_only injection reported success but no stamped image XObject could be read back from page ${pageIndex + 1} of the output PDF`,
              );
            }
          }
        }

        const injection: PrivateManifest["injection"] = {
          mode: injectionMode,
          pageIndex: result.pageIndex,
          pageIndexes: result.pageIndexes,
          position,
          fontSize: result.fontSize,
          boundingBox: result.boundingBox,
        };

        // Captured before extractText() runs: pdf.js's getDocument({data})
        // takes ownership of and detaches the ArrayBuffer it's given (documented
        // upstream behavior), so `result.bytes.byteLength` would read back as 0
        // if read *after* extractText() — capture the real size now instead of
        // trusting the buffer to still be intact later in this function.
        const outputSizeBytes = result.bytes.byteLength;

        await writeJobFile(config, jobId, "output.pdf", result.bytes);

        // Round 2 §0.1: xmp_only's hidden payload never lands in extractable
        // page text (textExtraction below), so overall/PASS for that mode is
        // gated on the XMP /Metadata payload instead — checkMetadataPayload()
        // reads it back the same way ValidationReport.serverValidation.metadata
        // / ValidationSummary.metadataPayloadPresent expect. MUST run before
        // extractText() below: pdf.js's getDocument({data}) detaches the
        // ArrayBuffer of whatever it's given (same reason outputSizeBytes was
        // captured above, before extractText runs) — running this after would
        // silently see a zero-length buffer and always report xmpPresent:false.
        const metadata =
          injectionMode === "xmp_only"
            ? await checkMetadataPayload(result.bytes, normalizedInstruction)
            : null;

        // No mode-aware comparison target: pdfjs-dist filters Cf-category
        // codepoints, so neither the plain nor the tag-encoded instruction can
        // ever match for unicode_tags — extractText() runs with the same plain
        // normalizedInstruction target as every other mode.
        const textExtraction = await extractText({
          bytes: result.bytes,
          targetInstruction: normalizedInstruction,
          targetPageIndex: result.pageIndex,
          targetPageIndexes: result.pageIndexes,
        });

        // Round 2 (unicode_tags): hiddenTextExtracted is expected/correct to
        // be false for this mode (see the block comment above the presence
        // gate) — computeOverall() already treats this as PASS_WITH_WARNINGS,
        // never FAIL. Surface *why* via a warning rather than leaving it
        // unexplained: the payload IS present (verified by the gate above),
        // just invisible to this project's pdfjs-dist-based extraction.
        const unicodeTagsWarnings: ValidationWarning[] =
          injectionMode === "unicode_tags"
            ? [
                {
                  code: "UNICODE_TAGS_NOT_EXTRACTABLE",
                  message:
                    "The Unicode Tag payload is present in the output PDF (verified via a " +
                    "public-pdf-lib-API CMap read-back) but is invisible to this project's " +
                    "PDF.js-based text extraction: pdfjs-dist unconditionally filters out " +
                    'Unicode General Category "Cf" (Format) glyphs, and the entire Unicode ' +
                    "Tags block (U+E0000-U+E007F) is category Cf. Provider-side visibility " +
                    "(what the Model Test measures) is unaffected by this.",
                  pageIndex: result.pageIndex,
                },
              ]
            : [];

        // Round-3 probe modes: hiddenTextExtracted is expected/correct to be
        // false for all four via this project's pdfjs-based extractText()
        // (mirrors the unicode_tags/xmp_only precedent above) —
        // computeOverall() already treats this as PASS_WITH_WARNINGS, never
        // FAIL. Surface *why*, per mode, rather than leaving it unexplained:
        // the payload IS present (verified by the mode-specific gate above),
        // just invisible to this project's extraction pipeline specifically.
        const probeModeWarnings: ValidationWarning[] = (() => {
          switch (injectionMode) {
            case "image_only":
              return [
                {
                  code: "IMAGE_ONLY_NOT_TEXT_EXTRACTABLE",
                  message:
                    "The instruction is present as a rasterized PNG image (verified via a " +
                    "public-pdf-lib-API image XObject read-back) with no text object of any " +
                    "kind on the page — by construction, no text extractor (including this " +
                    "project's PDF.js-based extractText()) can ever find it. This condition " +
                    "measures whether a provider's ingestion pipeline has a vision path, not " +
                    "text extractability.",
                  pageIndex: result.pageIndex,
                },
              ];
            case "freetext_annot":
              return [
                {
                  code: "FREETEXT_ANNOT_NOT_EXTRACTABLE",
                  message:
                    "The FreeText annotation payload is present in the output PDF (verified " +
                    "via a public-pdf-lib-API read-back of its /AP /N appearance stream and " +
                    "/Contents) but is invisible to this project's PDF.js-based " +
                    "extractText(), which only walks a page's own content stream, not its " +
                    "annotations' appearance streams. A poppler-family extractor (e.g. " +
                    "pdftotext) is expected to surface it via the same content-stream " +
                    "operator walk it uses for ordinary page text.",
                  pageIndex: result.pageIndex,
                },
              ];
            case "acroform_field":
              return [
                {
                  code: "ACROFORM_FIELD_NOT_EXTRACTABLE",
                  message:
                    "The AcroForm text field payload is present in the output PDF (verified " +
                    "via a public-pdf-lib-API PDFForm read-back of the field's /V and its " +
                    "appearance stream) but is invisible to this project's PDF.js-based " +
                    "extractText(), which only walks a page's own content stream, not a " +
                    "widget annotation's appearance stream. A poppler-family extractor (e.g. " +
                    "pdftotext) is expected to surface it via the same content-stream " +
                    "operator walk it uses for ordinary page text.",
                  pageIndex: result.pageIndex,
                },
              ];
            case "info_dict":
              return [
                {
                  code: "INFO_DICT_NOT_EXTRACTABLE",
                  message:
                    "The instruction is present in the output PDF's classic /Info dictionary " +
                    "(Subject/Keywords, verified via a public-pdf-lib-API read-back) but is " +
                    "invisible to this project's PDF.js-based extractText(), which never " +
                    "inspects document metadata. An extractor that reads /Info metadata " +
                    "(e.g. poppler's pdfinfo, pypdf's reader.metadata) is expected to " +
                    "surface it.",
                  pageIndex: result.pageIndex,
                },
              ];
            default:
              return [];
          }
        })();

        const outputPath = jobFilePath(config, jobId, "output.pdf");
        const qpdfResult = await qpdfCheck({ filePath: outputPath, enabled: config.qpdfEnabled });

        const geometryResult = compareGeometry(result.pageGeometryBefore, result.pageGeometryAfter);

        const report = buildReport({
          jobId,
          source: sourceInspection,
          output: {
            sha256: result.outputSha256,
            sizeBytes: outputSizeBytes,
            pageCount: result.pageGeometryAfter.length,
            pages: result.pageGeometryAfter,
          },
          injection,
          outputLoad: { passed: true },
          pageCountResult: {
            passed: true,
            before: sourceInspection.pageCount,
            after: result.pageGeometryAfter.length,
          },
          geometryResult,
          textExtraction,
          qpdf: qpdfResult,
          metadata,
          warnings: [...result.warnings, ...unicodeTagsWarnings, ...probeModeWarnings],
          lint: { errors: [], warnings: lint.warnings, acknowledged: acknowledgedWarnings },
          mode: injectionMode,
        });

        const manifest = buildManifest({
          jobId,
          sourceFile: {
            name: sourceInspection.filename,
            sha256: sourceInspection.sha256,
            sizeBytes: sourceInspection.sizeBytes,
          },
          outputFile: {
            name: `${stem}.injected.pdf`,
            sha256: result.outputSha256,
            sizeBytes: outputSizeBytes,
          },
          prompt: {
            sha256: promptSha256,
            instruction: fields.instruction,
            normalizedInstruction,
            length: normalizedInstruction.length,
            language: payloadLanguage,
          },
          expectedSignals,
          injection,
          validation: report.summary,
          toolVersions: toolVersions(
            deps,
            textExtraction.pdfJsVersion,
            qpdfResult.status !== "not_run",
          ),
        });

        await writeJobFile(config, jobId, "report.json", JSON.stringify(report, null, 2));
        await writeJobFile(config, jobId, "manifest.json", JSON.stringify(manifest, null, 2));

        jobsRepo.insert({
          id: jobId,
          status: "completed",
          sourceFilename: sourceInspection.filename,
          sourceSha256: sourceInspection.sha256,
          outputSha256: result.outputSha256,
          promptSha256,
          injectionMode,
          targetPage: result.pageIndex,
          targetPages: result.pageIndexes,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          errorCode: null,
          accessTokenHash,
        });

        return {
          jobId,
          accessToken,
          status: "completed" as const,
          errorCode: null,
          lintWarnings: lint.warnings,
        };
      } catch (err) {
        if (err instanceof ApiError && err.code === "PROCESSING_TIMEOUT") {
          // Let the outer withTimeLimit/catch handle cleanup uniformly —
          // don't reclassify this as INJECTION_FAILED or a hard-gate
          // "failed" job below.
          throw err;
        }
        if (!(err instanceof PdfEngineError)) {
          // Genuinely unexpected (non-typed) failure from the engine. Never
          // leak the raw message to the client; clean up the source.pdf we
          // already wrote and fail the whole request rather than silently
          // creating a job row for something we can't classify.
          await deleteJobDir(config, jobId);
          throw new ApiError("INJECTION_FAILED", "PDF injection failed unexpectedly.");
        }

        if (err.code === "VALIDATION_ERROR") {
          // Structurally a malformed-input rejection (e.g. pdf-engine's own
          // internal re-validation of targetPage range / custom position x,y —
          // both of which we already validate ourselves before ever calling
          // injectPdf(), so this is defensive, not expected to fire in
          // practice). Per the contract, VALIDATION_ERROR is a pre-processing
          // rejection: no job row, no persisted files.
          await deleteJobDir(config, jobId);
          throw new ApiError("VALIDATION_ERROR", err.message);
        }

        if (signal.aborted) {
          // The wall-clock timeout already fired while injectPdf() was hitting
          // a hard gate (e.g. GEOMETRY_CHANGED) — don't also persist a "failed"
          // job row/report/manifest for a request the client already saw
          // rejected with 504 (and whose source.pdf the outer catch is about
          // to delete anyway).
          throw new ApiError("PROCESSING_TIMEOUT");
        }

        // Hard-gate processing failure (GEOMETRY_CHANGED / INJECTION_FAILED /
        // OUTPUT_PARSE_FAILED / defensive PROMPT_ENCODING_FAILED). Persist a
        // best-effort report + manifest (no output.pdf), keep the row as
        // "failed", and still respond 201 per the API contract.
        const summary = buildSummary(
          {
            outputLoadPassed: false,
            pageCountPreserved: false,
            pageGeometryPreserved: false,
            hiddenTextExtracted: false,
            hasServerWarnings: true,
            qpdfStatus: "not_run",
            pdfJsRenderPassed: null,
            changedPixelRatio: null,
            metadataPayloadPresent: null,
          },
          injectionMode,
        );

        const report: ValidationReport = buildReport({
          jobId,
          source: sourceInspection,
          output: { sha256: "", sizeBytes: 0, pageCount: 0, pages: [] },
          injection: injectionInputCommon,
          outputLoad: { passed: false, error: err.message },
          pageCountResult: { passed: false, before: sourceInspection.pageCount, after: 0 },
          geometryResult: { passed: false, mismatches: [] },
          textExtraction: {
            pdfJsVersion: "n/a",
            pages: [],
            targetPageMatch: false,
            anyPageMatch: false,
          },
          qpdf: null,
          warnings: [{ code: err.code, message: err.message }],
          lint: { errors: [], warnings: lint.warnings, acknowledged: acknowledgedWarnings },
          mode: injectionMode,
        });
        void summary; // buildReport recomputes summary internally; kept for clarity of intent

        const manifest = buildManifest({
          jobId,
          sourceFile: {
            name: sourceInspection.filename,
            sha256: sourceInspection.sha256,
            sizeBytes: sourceInspection.sizeBytes,
          },
          outputFile: { name: "", sha256: "", sizeBytes: 0 },
          prompt: {
            sha256: promptSha256,
            instruction: fields.instruction,
            normalizedInstruction,
            length: normalizedInstruction.length,
            language: payloadLanguage,
          },
          expectedSignals,
          injection: injectionInputCommon,
          validation: report.summary,
          toolVersions: toolVersions(deps, "n/a", false),
        });

        await writeJobFile(config, jobId, "report.json", JSON.stringify(report, null, 2));
        await writeJobFile(config, jobId, "manifest.json", JSON.stringify(manifest, null, 2));

        jobsRepo.insert({
          id: jobId,
          status: "failed",
          sourceFilename: sourceInspection.filename,
          sourceSha256: sourceInspection.sha256,
          outputSha256: null,
          promptSha256,
          injectionMode,
          targetPage: resolvedTargetPageIndex,
          targetPages: resolvedTargetPageIndexes,
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          errorCode: err.code,
          accessTokenHash,
        });

        return {
          jobId,
          accessToken,
          status: "failed" as const,
          errorCode: err.code,
          lintWarnings: lint.warnings,
        };
      }
    }, config.maxProcessingMs);
  } catch (err) {
    if (err instanceof ApiError && err.code === "PROCESSING_TIMEOUT") {
      // Contract §0.3: PROCESSING_TIMEOUT -> 504, no row/files. Whatever
      // was written so far (source.pdf, and possibly output.pdf/report/
      // manifest if the race was lost late) is removed; no jobsRepo.insert()
      // call can have happened without also losing this same race (every
      // insert call site is preceded by a `signal.aborted` check above).
      await deleteJobDir(config, jobId).catch(() => {});
    }
    throw err;
  }
}

async function loadReport(config: AppConfig, jobId: string): Promise<ValidationReport | null> {
  if (!(await jobFileExists(config, jobId, "report.json"))) return null;
  const text = await readJobFileText(config, jobId, "report.json");
  return JSON.parse(text) as ValidationReport;
}

async function loadManifest(config: AppConfig, jobId: string): Promise<PrivateManifest | null> {
  if (!(await jobFileExists(config, jobId, "manifest.json"))) return null;
  const text = await readJobFileText(config, jobId, "manifest.json");
  return JSON.parse(text) as PrivateManifest;
}

export async function getJobStatus(
  deps: JobServiceDeps,
  job: StoredJobRow,
): Promise<JobStatusResponse> {
  const { config } = deps;
  const report = await loadReport(config, job.id);
  const [outputPdf, privateManifest, validationReport] = await Promise.all([
    jobFileExists(config, job.id, "output.pdf"),
    jobFileExists(config, job.id, "manifest.json"),
    jobFileExists(config, job.id, "report.json"),
  ]);

  return {
    jobId: job.id,
    status: job.status,
    errorCode: job.errorCode,
    sourceFilename: job.sourceFilename,
    injectionMode: job.injectionMode,
    targetPage: job.targetPage,
    targetPages: job.targetPages,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    summary: report?.summary ?? null,
    artifacts: { outputPdf, privateManifest, validationReport },
  };
}

export async function getOutputPdf(
  deps: JobServiceDeps,
  job: StoredJobRow,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { config } = deps;
  if (job.status !== "completed") {
    throw new ApiError("JOB_NOT_READY");
  }
  if (!(await jobFileExists(config, job.id, "output.pdf"))) {
    throw new ApiError("JOB_NOT_READY");
  }
  const report = await loadReport(config, job.id);
  if (report?.clientValidation?.renderPassed === false) {
    throw new ApiError("RENDER_FAILED");
  }
  const file = Bun.file(jobFilePath(config, job.id, "output.pdf"));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stem = sanitizeFilenameStem(job.sourceFilename);
  return { bytes, filename: `${stem}.injected.pdf` };
}

export async function getSourcePdf(
  deps: JobServiceDeps,
  job: StoredJobRow,
): Promise<{ bytes: Uint8Array }> {
  const { config } = deps;
  if (!(await jobFileExists(config, job.id, "source.pdf"))) {
    throw new ApiError("JOB_NOT_READY");
  }
  const file = Bun.file(jobFilePath(config, job.id, "source.pdf"));
  return { bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function getPrivateManifest(
  deps: JobServiceDeps,
  job: StoredJobRow,
): Promise<{ manifest: PrivateManifest; filename: string }> {
  const { config } = deps;
  const manifest = await loadManifest(config, job.id);
  if (!manifest) {
    throw new ApiError("JOB_NOT_READY");
  }
  const stem = sanitizeFilenameStem(job.sourceFilename);
  return { manifest, filename: `${stem}.private-manifest.json` };
}

export async function getValidationReport(
  deps: JobServiceDeps,
  job: StoredJobRow,
): Promise<{ report: ValidationReport; filename: string }> {
  const { config } = deps;
  const report = await loadReport(config, job.id);
  if (!report) {
    throw new ApiError("JOB_NOT_READY");
  }
  const stem = sanitizeFilenameStem(job.sourceFilename);
  return { report, filename: `${stem}.validation-report.json` };
}

export async function postClientValidation(
  deps: JobServiceDeps,
  job: StoredJobRow,
  input: ClientValidationInput,
): Promise<JobStatusResponse> {
  const { config } = deps;
  if (job.status !== "completed") {
    throw new ApiError("JOB_NOT_READY");
  }
  const report = await loadReport(config, job.id);
  const manifest = await loadManifest(config, job.id);
  if (!report || !manifest) {
    throw new ApiError("JOB_NOT_READY");
  }

  const updatedReport = mergeClientValidation(report, input, job.injectionMode);
  const updatedManifest: PrivateManifest = { ...manifest, validation: updatedReport.summary };

  await writeJobFile(config, job.id, "report.json", JSON.stringify(updatedReport, null, 2));
  await writeJobFile(config, job.id, "manifest.json", JSON.stringify(updatedManifest, null, 2));

  return getJobStatus(deps, job);
}

export async function deleteJob(deps: JobServiceDeps, jobId: string): Promise<void> {
  const { config, jobsRepo } = deps;
  await deleteJobDir(config, jobId);
  jobsRepo.delete(jobId);
}

export async function sweepExpiredJobs(deps: JobServiceDeps): Promise<number> {
  const { config, jobsRepo } = deps;
  const expired = jobsRepo.findExpired(new Date().toISOString());
  for (const job of expired) {
    if (!isValidJobId(job.id)) continue;
    await deleteJobDir(config, job.id);
    jobsRepo.delete(job.id);
  }
  return expired.length;
}
