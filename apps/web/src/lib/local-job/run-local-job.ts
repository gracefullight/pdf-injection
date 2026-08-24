import {
  type CreateJobResponse,
  diffThreshold,
  type InjectionMode,
  type PrivateManifest,
  type ValidationReport,
  type ValidationWarning,
} from "@pdf-injection/contracts";
import {
  buildManifest,
  compareGeometry,
  createBrowserPlatform,
  injectPdfModesInBrowser,
  inspectSource,
  isBrowserSupportedMode,
  normalizePrompt,
  PdfEngineError,
  readXmpPayload,
} from "@pdf-injection/pdf-engine/browser";
import { buildReport } from "@pdf-injection/validation/report";
import type { CreateJobInput } from "@/lib/api";
import { cjkFontSources } from "@/lib/local-job/cjk-font-assets";
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
 * All ten injection modes and all three payload languages work here: the
 * browser rasterizes `image_only` with its own canvas, and the CJK fonts and
 * HarfBuzz subsetter are fetched on demand (`cjk-font-assets.ts`) rather than
 * read from disk.
 *
 * What a local job still cannot do (genuinely server-side):
 *   - qpdf structural validation (external binary) → `qpdfStatus: "not_run"`
 *   - Model Test / Submissions / Robustness (provider calls, storage)
 */

export const LOCAL_JOB_ID_PREFIX = "local-";

/**
 * Built once and reused: the platform caches the HarfBuzz instance and the
 * downloaded font bytes, so only the first CJK/unicode_tags job pays for them.
 */
let platform: ReturnType<typeof createBrowserPlatform> | null = null;
function browserPlatform() {
  platform ??= createBrowserPlatform({ cjkFontSources });
  return platform;
}

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
    case "actual_text":
      return [
        {
          code: "ACTUAL_TEXT_NOT_EXTRACTED",
          message:
            "The instruction is present in a marked-content span's /ActualText property, " +
            "while its ordinary invisible glyph content is a fixed decoy. This project's " +
            "PDF.js extraction does not substitute /ActualText.",
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

/** Deduplicate an injection-mode list, preserving first-seen (primary-first) order. */
function dedupeModes(modes: readonly InjectionMode[]): InjectionMode[] {
  const seen = new Set<InjectionMode>();
  const out: InjectionMode[] = [];
  for (const mode of modes) {
    if (!seen.has(mode)) {
      seen.add(mode);
      out.push(mode);
    }
  }
  return out;
}

/**
 * The mode whose overall-status rules govern a combined (multi-channel) output.
 * The combined PDF's rendered pixel delta is the union of every applied mode's
 * paint, so the governing threshold is the *most lenient* (largest
 * `diffThreshold`) across the selection — otherwise a visible or white-text
 * channel in the set would push a stricter channel's diff over its limit and
 * FAIL a genuinely-good PDF. Ties keep the primary (first) mode.
 */
function governingValidationMode(modes: InjectionMode[]): InjectionMode {
  return modes.reduce(
    (best, mode) => (diffThreshold(mode) > diffThreshold(best) ? mode : best),
    modes[0] as InjectionMode,
  );
}

/** Collapse warnings sharing the same code + pageIndex, keeping the first. */
function dedupeWarnings(warnings: ValidationWarning[]): ValidationWarning[] {
  const seen = new Set<string>();
  const out: ValidationWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}@${warning.pageIndex ?? "-"}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(warning);
    }
  }
  return out;
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

  // Multi-channel selection: the primary mode is `injectionMode`; `modes` may
  // list additional channels to inject into the same PDF. Deduped, primary
  // first. A single-entry list is exactly the old single-mode behavior.
  const modes = dedupeModes(
    input.injectionModes?.length ? input.injectionModes : [input.injectionMode],
  );

  for (const mode of modes) {
    if (!isBrowserSupportedMode(mode)) {
      throw new LocalModeUnsupportedError(
        `Injection mode "${mode}" cannot be generated in this browser.`,
      );
    }
  }

  const sourceBytes = new Uint8Array(await input.file.arrayBuffer());
  const createdAt = new Date().toISOString();
  const jobId = `${LOCAL_JOB_ID_PREFIX}${crypto.randomUUID()}`;

  const sourceInspection = await inspectSource({
    bytes: sourceBytes,
    filename: input.file.name,
  });

  const normalizedInstruction = normalizePrompt(input.instruction);

  const result = await injectPdfModesInBrowser(
    {
      source: sourceBytes,
      instruction: input.instruction,
      mode: modes[0] as InjectionMode,
      modes,
      targetPage: input.targetPage ?? "last",
      position: input.position ?? "bottom",
      x: input.x,
      y: input.y,
      fontSize: input.fontSize,
      maxWidth: input.maxWidth,
      payloadLanguage,
    },
    browserPlatform(),
  );

  const outputBytes = result.bytes;
  const textExtraction = await extractTextInBrowser({
    bytes: outputBytes,
    targetInstruction: normalizedInstruction,
    targetPageIndex: result.pageIndex,
    targetPageIndexes: result.pageIndexes,
  });

  // The mode whose extraction/threshold expectations govern the overall
  // verdict for the combined output. With several channels in one PDF the
  // rendered pixel delta is the union of every mode's paint, so the most
  // lenient diff threshold (largest) must win or a visible/whiter channel
  // would spuriously FAIL a stricter one. Ties keep the primary (first) mode.
  const validationMode = governingValidationMode(modes);

  // xmp_only writes the payload into the catalog's /Metadata stream and is
  // never in page text, so its summary is gated on this read-back rather than
  // on extraction. The server uses pdf.js's getMetadata(); `readXmpPayload()`
  // is the engine's own pure-pdf-lib reader and works identically here.
  const metadata = modes.includes("xmp_only")
    ? await localMetadataCheck(outputBytes, normalizedInstruction)
    : null;

  const injection: PrivateManifest["injection"] = {
    mode: modes[0] as InjectionMode,
    modes,
    pageIndex: result.pageIndex,
    pageIndexes: result.pageIndexes,
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
      // One "payload present but not extractable by this app" note per selected
      // channel that has one (deduped by code, keeping first).
      ...dedupeWarnings(modes.flatMap((mode) => nonExtractableWarnings(mode, result.pageIndex))),
    ],
    lint: { errors: [], warnings: [], acknowledged: input.acknowledgedWarnings ?? [] },
    mode: validationMode,
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
