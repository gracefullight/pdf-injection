import { describe, expect, it } from "bun:test";
import type { PrivateManifest, ValidationReport } from "@pdf-injection/contracts";
import {
  applyLocalClientValidation,
  deleteLocalJob,
  getLocalJob,
  localJobStatus,
  putLocalJob,
  requireLocalJob,
} from "@/lib/local-job/local-job-store";
import { isLocalJobId, type LocalJob } from "@/lib/local-job/run-local-job";

function fakeJob(jobId: string): LocalJob {
  const summary: ValidationReport["summary"] = {
    overall: "NOT_TESTED",
    outputLoadPassed: true,
    pageCountPreserved: true,
    pageGeometryPreserved: true,
    hiddenTextExtracted: true,
    pdfJsRenderPassed: null,
    changedPixelRatio: null,
    qpdfStatus: "not_run",
    metadataPayloadPresent: null,
  };
  const manifest = {
    schemaVersion: "0.2",
    jobId,
    sourceFile: { name: "a.pdf", sha256: "s", sizeBytes: 1 },
    outputFile: { name: "a.injected.pdf", sha256: "o", sizeBytes: 2 },
    prompt: {
      sha256: "p",
      instruction: "i",
      normalizedInstruction: "i",
      language: "en",
      length: 1,
    },
    expectedSignals: [],
    injection: {
      mode: "white_text",
      pageIndex: 3,
      position: "bottom",
      fontSize: 1,
      boundingBox: [0, 0, 1, 1],
    },
    validation: summary,
    toolVersions: { bun: "n/a", pdfLib: "1.17.1", pdfJs: "4", qpdf: null, pdfInjection: "0.1.0" },
    createdAt: "2026-01-01T00:00:00.000Z",
    warning: "PRIVATE — contains the hidden instruction. Do not distribute to students.",
  } as PrivateManifest;

  return {
    jobId,
    accessToken: "local-token",
    manifest,
    report: {
      schemaVersion: "0.2",
      jobId,
      createdAt: manifest.createdAt,
      updatedAt: manifest.createdAt,
      source: {
        filename: "a.pdf",
        sha256: "s",
        sizeBytes: 1,
        pageCount: 4,
        pages: [],
        encrypted: false,
        signed: false,
        riskFlags: {
          javascript: false,
          embeddedFiles: false,
          externalUriCount: 0,
          openAction: false,
        },
      },
      output: { sha256: "o", sizeBytes: 2, pageCount: 4, pages: [], fileSizeDelta: 1 },
      injection: manifest.injection,
      serverValidation: {
        outputLoad: { passed: true },
        pageCount: { passed: true, before: 4, after: 4 },
        geometry: { passed: true, mismatches: [] },
        textExtraction: { pdfJsVersion: "4", pages: [], targetPageMatch: true, anyPageMatch: true },
        qpdf: null,
        metadata: { xmpPresent: false, payloadFound: false, sha256OfPayload: null },
        warnings: [],
      },
      clientValidation: null,
      lint: { errors: [], warnings: [], acknowledged: [] },
      summary,
      disclaimer: "PDF.js parser view — may differ from actual LLM provider ingestion.",
    } as unknown as ValidationReport,
    sourceBytes: new Uint8Array([1]),
    outputBytes: new Uint8Array([2, 3]),
    sourceFilename: "a.pdf",
    createdAt: manifest.createdAt,
  };
}

describe("isLocalJobId", () => {
  it("only matches ids minted locally", () => {
    expect(isLocalJobId("local-abc")).toBe(true);
    expect(isLocalJobId("7f4d1e2c-0000-4000-8000-000000000000")).toBe(false);
  });
});

describe("local job store", () => {
  it("stores, reads and deletes a job", () => {
    const job = fakeJob("local-store-1");
    putLocalJob(job);
    expect(getLocalJob("local-store-1")).toBe(job);
    expect(requireLocalJob("local-store-1").sourceFilename).toBe("a.pdf");
    deleteLocalJob("local-store-1");
    expect(getLocalJob("local-store-1")).toBeUndefined();
  });

  it("explains that a missing job was lost to a reload rather than throwing something opaque", () => {
    expect(() => requireLocalJob("local-missing")).toThrow(/no longer in memory/);
  });

  it("reports targetPage as the 0-based page index, matching the server's JobStatusResponse", () => {
    // Regression: the UI adds 1 for display (human-view-tab.tsx), and the server stores
    // `result.pageIndex` verbatim — pre-incrementing here showed "page 5" on a 4-page PDF.
    putLocalJob(fakeJob("local-store-2"));
    const status = localJobStatus("local-store-2");
    expect(status.targetPage).toBe(3);
    expect(status.status).toBe("completed");
    expect(status.artifacts).toEqual({
      outputPdf: true,
      privateManifest: true,
      validationReport: true,
    });
  });

  it("merges client validation into both the report and the manifest summary", () => {
    putLocalJob(fakeJob("local-store-3"));
    const merged = applyLocalClientValidation("local-store-3", {
      pdfJsVersion: "4",
      renderPassed: true,
      renderErrors: [],
      visualDiff: {
        scale: 2,
        thresholdRatio: 0.02,
        pages: [],
        changedPixelRatio: 0,
        passed: true,
      },
      extractedText: { pages: [], targetPageMatch: true, anyPageMatch: true },
    });

    expect(merged.summary.pdfJsRenderPassed).toBe(true);
    expect(merged.summary.overall).not.toBe("NOT_TESTED");
    // The stored job is replaced, so a later read sees the merged state.
    expect(requireLocalJob("local-store-3").report.summary.overall).toBe(merged.summary.overall);
    expect(requireLocalJob("local-store-3").manifest.validation.overall).toBe(
      merged.summary.overall,
    );
  });
});
