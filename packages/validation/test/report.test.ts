import { describe, expect, test } from "bun:test";
import type {
  ClientValidationInput,
  PageGeometry,
  SourceInspection,
} from "@pdf-injection/contracts";
import { buildReport, mergeClientValidation } from "../src/report";

function page(pageIndex = 0): PageGeometry {
  return {
    pageIndex,
    mediaBox: [0, 0, 612, 792],
    cropBox: [0, 0, 612, 792],
    rotation: 0,
    width: 612,
    height: 792,
  };
}

function baseSourceInspection(): SourceInspection {
  return {
    filename: "assignment.pdf",
    sizeBytes: 1000,
    sha256: "a".repeat(64),
    pageCount: 1,
    encrypted: false,
    signed: false,
    pdfVersion: "1.7",
    pages: [page()],
    riskFlags: { javascript: false, embeddedFiles: false, externalUriCount: 0, openAction: false },
  };
}

function buildReportInput(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
  return {
    jobId: "job-1",
    source: baseSourceInspection(),
    output: { sha256: "b".repeat(64), sizeBytes: 1050, pageCount: 1, pages: [page()] },
    injection: {
      mode: "white_text" as const,
      pageIndex: 0,
      position: "bottom" as const,
      fontSize: 1,
      boundingBox: [24, 10, 571, 30] as [number, number, number, number],
    },
    outputLoad: { passed: true },
    pageCountResult: { passed: true, before: 1, after: 1 },
    geometryResult: { passed: true, mismatches: [] },
    textExtraction: {
      pdfJsVersion: "4.10.38",
      pages: [
        {
          pageIndex: 0,
          textLength: 100,
          exactMatch: true,
          normalizedMatch: true,
          caseInsensitiveMatch: true,
          matchOffset: 10,
        },
      ],
      targetPageMatch: true,
      anyPageMatch: true,
    },
    qpdf: null,
    warnings: [],
    lint: { errors: [], warnings: [], acknowledged: [] },
    mode: "white_text" as const,
    ...overrides,
  };
}

describe("buildReport", () => {
  test("produces a ValidationReport with schemaVersion 0.2 and the mandatory disclaimer", () => {
    const report = buildReport(buildReportInput());
    expect(report.schemaVersion).toBe("0.2");
    expect(report.disclaimer).toBe(
      "PDF.js parser view — may differ from actual LLM provider ingestion.",
    );
  });

  test("computes output.fileSizeDelta from source/output sizeBytes", () => {
    const report = buildReport(buildReportInput());
    expect(report.output.fileSizeDelta).toBe(50);
  });

  test("summary.overall is NOT_TESTED before client validation is posted", () => {
    const report = buildReport(buildReportInput());
    expect(report.summary.pdfJsRenderPassed).toBeNull();
    expect(report.summary.changedPixelRatio).toBeNull();
    expect(report.summary.overall).toBe("NOT_TESTED");
  });

  test("summary.hiddenTextExtracted reflects textExtraction.targetPageMatch", () => {
    const report = buildReport(buildReportInput());
    expect(report.summary.hiddenTextExtracted).toBe(true);
  });

  test("clientValidation is null until merged", () => {
    const report = buildReport(buildReportInput());
    expect(report.clientValidation).toBeNull();
  });

  test("carries through lint errors/warnings/acknowledged", () => {
    const report = buildReport(
      buildReportInput({
        lint: {
          errors: [],
          warnings: [{ id: "fake_citation", severity: "warning", message: "..." }],
          acknowledged: ["fake_citation"],
        },
      }),
    );
    expect(report.lint.warnings).toHaveLength(1);
    expect(report.lint.acknowledged).toEqual(["fake_citation"]);
  });

  test("serverValidation.metadata defaults to xmpPresent/payloadFound false when not provided", () => {
    const report = buildReport(buildReportInput());
    expect(report.serverValidation.metadata).toEqual({
      xmpPresent: false,
      payloadFound: false,
      sha256OfPayload: null,
    });
  });

  test("summary.metadataPayloadPresent is null for non-xmp_only modes regardless of the metadata input", () => {
    const report = buildReport(
      buildReportInput({
        metadata: { xmpPresent: true, payloadFound: true, sha256OfPayload: "c".repeat(64) },
      }),
    );
    expect(report.summary.metadataPayloadPresent).toBeNull();
  });

  describe("mode xmp_only", () => {
    function xmpOnlyInput(overrides: Partial<Parameters<typeof buildReport>[0]> = {}) {
      return buildReportInput({
        mode: "xmp_only" as const,
        injection: {
          mode: "xmp_only" as const,
          pageIndex: 0,
          position: "bottom" as const,
          fontSize: 1,
          boundingBox: [24, 10, 571, 30] as [number, number, number, number],
        },
        // xmp_only does not modify page content, so hiddenTextExtracted stays false.
        textExtraction: {
          pdfJsVersion: "4.10.38",
          pages: [
            {
              pageIndex: 0,
              textLength: 100,
              exactMatch: false,
              normalizedMatch: false,
              caseInsensitiveMatch: false,
              matchOffset: null,
            },
          ],
          targetPageMatch: false,
          anyPageMatch: false,
        },
        ...overrides,
      });
    }

    test("passes serverValidation.metadata through and sets metadataPayloadPresent from payloadFound", () => {
      const metadata = { xmpPresent: true, payloadFound: true, sha256OfPayload: "d".repeat(64) };
      const report = buildReport(xmpOnlyInput({ metadata }));
      expect(report.serverValidation.metadata).toEqual(metadata);
      expect(report.summary.metadataPayloadPresent).toBe(true);
    });

    test("overall does not FAIL on missing hiddenTextExtracted (content untouched by design)", () => {
      const metadata = { xmpPresent: true, payloadFound: true, sha256OfPayload: "d".repeat(64) };
      const report = buildReport(xmpOnlyInput({ metadata }));
      expect(report.summary.hiddenTextExtracted).toBe(false);
      // NOT_TESTED (not FAIL) — pdfJsRenderPassed is still null pre-client-validation.
      expect(report.summary.overall).toBe("NOT_TESTED");
    });

    test("overall FAILs when metadataPayloadPresent is false, even after a clean client validation", () => {
      const metadata = { xmpPresent: false, payloadFound: false, sha256OfPayload: null };
      const report = buildReport(xmpOnlyInput({ metadata }));
      const updated = mergeClientValidation(
        report,
        {
          pdfJsVersion: "4.10.38",
          renderPassed: true,
          renderErrors: [],
          visualDiff: {
            scale: 2,
            thresholdRatio: 1e-7,
            pages: [
              {
                pageIndex: 0,
                width: 1224,
                height: 1584,
                changedPixels: 0,
                changedPixelRatio: 0,
                maxChannelDelta: 0,
                meanAbsoluteDifference: 0,
                passed: true,
              },
            ],
            changedPixelRatio: 0,
            passed: true,
          },
          extractedText: { pages: [], targetPageMatch: false, anyPageMatch: false },
        },
        "xmp_only",
      );
      expect(updated.summary.metadataPayloadPresent).toBe(false);
      expect(updated.summary.overall).toBe("FAIL");
    });

    test("overall PASSes when metadataPayloadPresent is true and client validation is clean", () => {
      const metadata = { xmpPresent: true, payloadFound: true, sha256OfPayload: "e".repeat(64) };
      const report = buildReport(xmpOnlyInput({ metadata }));
      const updated = mergeClientValidation(
        report,
        {
          pdfJsVersion: "4.10.38",
          renderPassed: true,
          renderErrors: [],
          visualDiff: {
            scale: 2,
            thresholdRatio: 1e-7,
            pages: [
              {
                pageIndex: 0,
                width: 1224,
                height: 1584,
                changedPixels: 0,
                changedPixelRatio: 0,
                maxChannelDelta: 0,
                meanAbsoluteDifference: 0,
                passed: true,
              },
            ],
            changedPixelRatio: 0,
            passed: true,
          },
          extractedText: { pages: [], targetPageMatch: false, anyPageMatch: false },
        },
        "xmp_only",
      );
      expect(updated.summary.overall).toBe("PASS");
    });
  });
});

describe("mergeClientValidation", () => {
  function clientValidation(overrides: Partial<ClientValidationInput> = {}): ClientValidationInput {
    return {
      pdfJsVersion: "4.10.38",
      renderPassed: true,
      renderErrors: [],
      visualDiff: {
        scale: 2,
        thresholdRatio: 1e-5,
        pages: [
          {
            pageIndex: 0,
            width: 1224,
            height: 1584,
            changedPixels: 0,
            changedPixelRatio: 0,
            maxChannelDelta: 0,
            meanAbsoluteDifference: 0,
            passed: true,
          },
        ],
        changedPixelRatio: 0,
        passed: true,
      },
      extractedText: {
        pages: [
          {
            pageIndex: 0,
            textLength: 100,
            exactMatch: true,
            normalizedMatch: true,
            caseInsensitiveMatch: true,
            matchOffset: 10,
          },
        ],
        targetPageMatch: true,
        anyPageMatch: true,
      },
      ...overrides,
    };
  }

  test("recomputes overall to PASS when the client reports a clean render + diff", () => {
    const report = buildReport(buildReportInput());
    const updated = mergeClientValidation(report, clientValidation(), "white_text");
    expect(updated.summary.pdfJsRenderPassed).toBe(true);
    expect(updated.summary.changedPixelRatio).toBe(0);
    expect(updated.summary.overall).toBe("PASS");
    expect(updated.clientValidation).not.toBeNull();
  });

  test("recomputes overall to FAIL when the client reports a render failure", () => {
    const report = buildReport(buildReportInput());
    const updated = mergeClientValidation(
      report,
      clientValidation({ renderPassed: false }),
      "white_text",
    );
    expect(updated.summary.overall).toBe("FAIL");
  });

  test("updates updatedAt to a newer timestamp than createdAt", () => {
    const report = buildReport(buildReportInput({ createdAt: "2020-01-01T00:00:00.000Z" }));
    const updated = mergeClientValidation(report, clientValidation(), "white_text");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(report.createdAt).getTime(),
    );
  });

  test("does not mutate the original report object", () => {
    const report = buildReport(buildReportInput());
    const updated = mergeClientValidation(report, clientValidation(), "white_text");
    expect(report.clientValidation).toBeNull();
    expect(updated).not.toBe(report);
  });
});
