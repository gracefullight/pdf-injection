import type {
  CreateJobResponse,
  PrivateManifest,
  ValidationReport,
  ValidationWarning,
} from "@pdf-injection/contracts";
import {
  buildManifest,
  compareGeometry,
  injectPdfInBrowser,
  inspectSource,
  isBrowserSupportedMode,
  normalizePrompt,
  PdfEngineError,
  readXmpPayload,
} from "@pdf-injection/pdf-engine/browser";
import { buildReport } from "@pdf-injection/validation/report";
import type { CreateJobInput } from "@/lib/api";
import { extractTextInBrowser } from "@/lib/local-job/local-text-extract";
import { pdfJsVersion } from "@/lib/pdfjs";

/**
 * Local (server-free) job execution: the whole authoring pipeline —
 * inspect → inject → re-parse → geometry check → text extraction → report and
 * private manifest — running on-device in the browser.
 *
 * It reuses the *same* engine code as `apps/api`: `injectPdfInBrowser` is the
 * shared `injectPdfWith` dispatcher with a browser capability set
 * (`packages/pdf-engine/src/inject-browser.ts`), and the report/manifest are
 * built by the same `buildReport`/`buildManifest` the server calls. The only
 * substitution is text extraction, which goes through the app's browser pdf.js
 * worker instead of the Node-only legacy build (see `local-text-extract.ts`).
 *
 * What a local job cannot do, by construction (all server-only):
 *   - `image_only` / `unicode_tags` modes, and `payloadLanguage` `"ko"`/`"zh"`
 *     — they need a native canvas or the on-disk CJK font subset
 *   - qpdf structural validation (external binary) → `qpdfStatus: "not_run"`
 *   - Model Test / Submissions / Robustness (provider calls, storage)
 */

export const LOCAL_JOB_ID_PREFIX = "local-";

/** Mirrors `apps/api`'s `toolVersions()` — pdf-lib ships no runtime version export. */
const PDF_LIB_VERSION = "1.17.1";

/** A job that never left the browser. `accessToken` exists only to match the API shape. */
export interface LocalJob {
  jobId: string;
  accessToken: string;
  manifest: PrivateManifest;
  report: ValidationReport;
  sourceBytes: Uint8Array;
  outputBytes: Uint8Array;
  sourceFilename: string;
  createdAt: string;
}

export interface RunLocalJobResult {
  job: LocalJob;
  response: CreateJobResponse;
}

/** True for a job id minted by `runLocalJob` (never issued by the server). */
export function isLocalJobId(jobId: string): boolean {
  return jobId.startsWith(LOCAL_JOB_ID_PREFIX);
}

function outputFileName(sourceName: string): string {
  const stem = sourceName.replace(/\.pdf$/i, "");
  return `${stem}.injected.pdf`;
}

/**
 * Mode-specific "the payload is present but this app's PDF.js extraction
 * cannot see it" warnings, mirroring `apps/api`'s `probeModeWarnings` so a
 * locally generated report reads identically to a server-generated one.
 */
function nonExtractableWarnings(
  mode: PrivateManifest["injection"]["mode"],
  pageIndex: number,
): ValidationWarning[] {
  switch (mode) {
    case "freetext_annot":
      return [
        {
          code: "FREETEXT_ANNOT_NOT_EXTRACTABLE",
          message:
            "The instruction is present in the output PDF (inside the FreeText annotation's " +
            "appearance stream) but is invisible to this project's PDF.js-based text " +
            "extraction, which only walks a page's own content stream.",
          pageIndex,
        },
      ];
    case "acroform_field":
      return [
        {
          code: "ACROFORM_FIELD_NOT_EXTRACTABLE",
          message:
            "The instruction is present in the output PDF (inside the AcroForm widget's " +
            "appearance stream) but is invisible to this project's PDF.js-based text " +
            "extraction, which only walks a page's own content stream.",
          pageIndex,
        },
      ];
    case "info_dict":
      return [
        {
          code: "INFO_DICT_NOT_EXTRACTABLE",
          message:
            "The instruction is present in the output PDF's /Info dictionary " +
            "(Subject/Keywords) but is invisible to this project's PDF.js-based text " +
            "extraction, which never inspects document metadata.",
          pageIndex,
        },
      ];
    default:
      return [];
  }
}

/**
 * Browser equivalent of `@pdf-injection/validation`'s `checkMetadataPayload()`
 * (which needs the Node-only pdf.js legacy build): reads the XMP packet back
 * with the engine's own pure-pdf-lib reader and reports it in the same shape.
 */
async function localMetadataCheck(
  bytes: Uint8Array,
  normalizedInstruction: string,
): Promise<ValidationReport["serverValidation"]["metadata"]> {
  const payload = await readXmpPayload(bytes);
  if (!payload.xmpPresent) {
    return { xmpPresent: false, payloadFound: false, sha256OfPayload: null };
  }
  const found = (payload.instruction ?? "").includes(normalizedInstruction);
  return {
    xmpPresent: true,
    payloadFound: found,
    sha256OfPayload: payload.promptSha256,
  };
}

/** Thrown for inputs a local job structurally cannot handle; carries a user-facing reason. */
export class LocalModeUnsupportedError extends Error {
  readonly code = "LOCAL_MODE_UNSUPPORTED";
  constructor(message: string) {
    super(message);
    this.name = "LocalModeUnsupportedError";
  }
}

export async function runLocalJob(input: CreateJobInput): Promise<RunLocalJobResult> {
  const payloadLanguage = input.payloadLanguage ?? "en";

  if (!isBrowserSupportedMode(input.injectionMode)) {
    throw new LocalModeUnsupportedError(
      `Injection mode "${input.injectionMode}" needs the server (native canvas or the bundled ` +
        "CJK font). Pick another mode, or connect an API server.",
    );
  }
  if (payloadLanguage !== "en") {
    throw new LocalModeUnsupportedError(
      `Payload language "${payloadLanguage}" needs the server's bundled CJK font subset. Use ` +
        "English, or connect an API server.",
    );
  }

  const sourceBytes = new Uint8Array(await input.file.arrayBuffer());
  const createdAt = new Date().toISOString();
  const jobId = `${LOCAL_JOB_ID_PREFIX}${crypto.randomUUID()}`;

  const sourceInspection = await inspectSource({
    bytes: sourceBytes,
    filename: input.file.name,
  });

  const normalizedInstruction = normalizePrompt(input.instruction);

  const result = await injectPdfInBrowser({
    source: sourceBytes,
    instruction: input.instruction,
    mode: input.injectionMode,
    targetPage: input.targetPage ?? "last",
    position: input.position ?? "bottom",
    x: input.x,
    y: input.y,
    fontSize: input.fontSize,
    maxWidth: input.maxWidth,
    payloadLanguage,
  });

  const outputBytes = result.bytes;
  const textExtraction = await extractTextInBrowser({
    bytes: outputBytes,
    targetInstruction: normalizedInstruction,
    targetPageIndex: result.pageIndex,
  });

  // xmp_only writes the payload into the catalog's /Metadata stream and is
  // never in page text, so its summary is gated on this read-back rather than
  // on extraction. The server uses pdf.js's getMetadata(); `readXmpPayload()`
  // is the engine's own pure-pdf-lib reader and works identically here.
  const metadata =
    input.injectionMode === "xmp_only"
      ? await localMetadataCheck(outputBytes, normalizedInstruction)
      : null;

  const injection: PrivateManifest["injection"] = {
    mode: input.injectionMode,
    pageIndex: result.pageIndex,
    position: input.position ?? "bottom",
    fontSize: result.fontSize,
    boundingBox: result.boundingBox,
  };

  const report = buildReport({
    jobId,
    createdAt,
    source: sourceInspection,
    output: {
      sha256: result.outputSha256,
      sizeBytes: outputBytes.byteLength,
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
    geometryResult: compareGeometry(result.pageGeometryBefore, result.pageGeometryAfter),
    textExtraction,
    // qpdf is an external binary — never available in a browser.
    qpdf: null,
    metadata,
    warnings: [
      ...result.warnings,
      ...nonExtractableWarnings(input.injectionMode, result.pageIndex),
    ],
    lint: { errors: [], warnings: [], acknowledged: input.acknowledgedWarnings ?? [] },
    mode: input.injectionMode,
  });

  const manifest = buildManifest({
    jobId,
    sourceFile: {
      name: sourceInspection.filename,
      sha256: sourceInspection.sha256,
      sizeBytes: sourceInspection.sizeBytes,
    },
    outputFile: {
      name: outputFileName(sourceInspection.filename),
      sha256: result.outputSha256,
      sizeBytes: outputBytes.byteLength,
    },
    prompt: {
      sha256: result.promptSha256,
      instruction: input.instruction,
      normalizedInstruction,
      language: payloadLanguage,
      length: normalizedInstruction.length,
    },
    expectedSignals: input.expectedSignals,
    injection,
    validation: report.summary,
    toolVersions: {
      // No Bun/qpdf in a browser; the field is required, so record what ran instead.
      bun: "n/a (local mode — generated in the browser)",
      pdfLib: PDF_LIB_VERSION,
      pdfJs: pdfJsVersion,
      qpdf: null,
      pdfInjection: "0.1.0",
    },
    createdAt,
  });

  return {
    job: {
      jobId,
      accessToken: `${LOCAL_JOB_ID_PREFIX}token`,
      manifest,
      report,
      sourceBytes,
      outputBytes,
      sourceFilename: sourceInspection.filename,
      createdAt,
    },
    response: {
      jobId,
      accessToken: `${LOCAL_JOB_ID_PREFIX}token`,
      status: "completed",
      errorCode: null,
      lintWarnings: [],
    },
  };
}

/** Maps an engine error to a message suitable for the generate screen's alert. */
export function localJobErrorMessage(error: unknown): string {
  if (error instanceof LocalModeUnsupportedError) return error.message;
  if (error instanceof PdfEngineError) return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : "Local generation failed.";
}
