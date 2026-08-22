import {
  type ClientValidationInput,
  computeOverall,
  type InjectionMode,
  type LintIssue,
  type PageGeometry,
  type PrivateManifest,
  type QpdfStatus,
  type SourceInspection,
  type ValidationReport,
  type ValidationSummary,
  type ValidationWarning,
} from "@pdf-injection/contracts";
import type { MetadataCheckResult } from "./metadata-check";

const NO_METADATA: ValidationReport["serverValidation"]["metadata"] = {
  xmpPresent: false,
  payloadFound: false,
  sha256OfPayload: null,
};

export interface BuildReportInput {
  jobId: string;
  createdAt?: string;
  source: SourceInspection;
  output: { sha256: string; sizeBytes: number; pageCount: number; pages: PageGeometry[] };
  injection: PrivateManifest["injection"];
  outputLoad: { passed: boolean; error?: string };
  pageCountResult: { passed: boolean; before: number; after: number };
  geometryResult: {
    passed: boolean;
    mismatches: Array<{ pageIndex: number; field: string; before: unknown; after: unknown }>;
  };
  textExtraction: ValidationReport["serverValidation"]["textExtraction"];
  qpdf: {
    status: QpdfStatus;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    warningCount: number;
    errorCount: number;
  } | null;
  /**
   * XMP /Metadata inspection (packages/validation metadata-check.ts,
   * checkMetadataPayload). Only meaningful for mode "xmp_only"; omitted or
   * null for other modes falls back to { xmpPresent: false, payloadFound:
   * false, sha256OfPayload: null } since ValidationReport.serverValidation.
   * metadata is a required field regardless of mode.
   */
  metadata?: MetadataCheckResult | null;
  warnings: ValidationWarning[];
  lint: { errors: LintIssue[]; warnings: LintIssue[]; acknowledged: string[] };
  mode: InjectionMode;
}

const DISCLAIMER = "PDF.js parser view — may differ from actual LLM provider ingestion." as const;

interface SummaryParts {
  outputLoadPassed: boolean;
  pageCountPreserved: boolean;
  pageGeometryPreserved: boolean;
  hiddenTextExtracted: boolean;
  hasServerWarnings: boolean;
  qpdfStatus: QpdfStatus;
  pdfJsRenderPassed: boolean | null;
  changedPixelRatio: number | null;
  /**
   * Whether the XMP payload was found. Only meaningful (non-null) for mode
   * "xmp_only" — see ValidationSummary.metadataPayloadPresent and
   * computeOverall() in @pdf-injection/contracts.
   */
  metadataPayloadPresent: boolean | null;
}

function computeSummary(parts: SummaryParts, mode: InjectionMode): ValidationSummary {
  return {
    outputLoadPassed: parts.outputLoadPassed,
    pdfJsRenderPassed: parts.pdfJsRenderPassed,
    pageCountPreserved: parts.pageCountPreserved,
    pageGeometryPreserved: parts.pageGeometryPreserved,
    hiddenTextExtracted: parts.hiddenTextExtracted,
    changedPixelRatio: parts.changedPixelRatio,
    qpdfStatus: parts.qpdfStatus,
    metadataPayloadPresent: parts.metadataPayloadPresent,
    overall: computeOverall(parts, mode),
  };
}

/** buildSummary — exposed standalone for callers that only need the summary object. */
export function buildSummary(parts: SummaryParts, mode: InjectionMode): ValidationSummary {
  return computeSummary(parts, mode);
}

/**
 * Builds the ValidationReport artifact from server-side validation results.
 * clientValidation starts null and summary.overall starts NOT_TESTED until
 * the browser posts POST /client-validation (see mergeClientValidation).
 */
export function buildReport(input: BuildReportInput): ValidationReport {
  const now = input.createdAt ?? new Date().toISOString();

  const metadata = input.metadata ?? NO_METADATA;
  const metadataPayloadPresent = input.mode === "xmp_only" ? metadata.payloadFound : null;

  const summary = computeSummary(
    {
      outputLoadPassed: input.outputLoad.passed,
      pageCountPreserved: input.pageCountResult.passed,
      pageGeometryPreserved: input.geometryResult.passed,
      hiddenTextExtracted: input.textExtraction.targetPageMatch,
      hasServerWarnings: input.warnings.length > 0,
      qpdfStatus: input.qpdf?.status ?? "not_run",
      pdfJsRenderPassed: null,
      changedPixelRatio: null,
      metadataPayloadPresent,
    },
    input.mode,
  );

  return {
    schemaVersion: "0.2",
    jobId: input.jobId,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    output: {
      sha256: input.output.sha256,
      sizeBytes: input.output.sizeBytes,
      pageCount: input.output.pageCount,
      pages: input.output.pages,
      fileSizeDelta: input.output.sizeBytes - input.source.sizeBytes,
    },
    injection: input.injection,
    serverValidation: {
      outputLoad: input.outputLoad,
      pageCount: input.pageCountResult,
      geometry: input.geometryResult,
      textExtraction: input.textExtraction,
      qpdf: input.qpdf,
      metadata,
      warnings: input.warnings,
    },
    clientValidation: null,
    summary,
    lint: input.lint,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Merges browser-computed render/diff/extraction results into an existing
 * report, recomputing summary.overall. Returns a new report object (does
 * not mutate the input). PRD §13.4 / POST /client-validation.
 */
export function mergeClientValidation(
  report: ValidationReport,
  clientValidation: ClientValidationInput,
  mode: InjectionMode,
): ValidationReport {
  const summary = computeSummary(
    {
      outputLoadPassed: report.summary.outputLoadPassed,
      pageCountPreserved: report.summary.pageCountPreserved,
      pageGeometryPreserved: report.summary.pageGeometryPreserved,
      hiddenTextExtracted: report.summary.hiddenTextExtracted,
      hasServerWarnings: report.serverValidation.warnings.length > 0,
      qpdfStatus: report.summary.qpdfStatus,
      pdfJsRenderPassed: clientValidation.renderPassed,
      changedPixelRatio: clientValidation.visualDiff.changedPixelRatio,
      // Metadata is a server-side check independent of the browser render/
      // diff pass — carry the existing value through unchanged.
      metadataPayloadPresent: report.summary.metadataPayloadPresent,
    },
    mode,
  );

  return {
    ...report,
    updatedAt: new Date().toISOString(),
    clientValidation,
    summary,
  };
}
