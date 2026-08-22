import { describe, expect, test } from "bun:test";
import type { OverallStatusParts } from "../src/overall";
import { computeOverall, diffThreshold } from "../src/overall";

function baseParts(overrides: Partial<OverallStatusParts> = {}): OverallStatusParts {
  return {
    outputLoadPassed: true,
    pageCountPreserved: true,
    pageGeometryPreserved: true,
    pdfJsRenderPassed: true,
    hiddenTextExtracted: true,
    changedPixelRatio: 0,
    hasServerWarnings: false,
    qpdfStatus: "not_run",
    metadataPayloadPresent: null,
    ...overrides,
  };
}

describe("diffThreshold", () => {
  test("white_text threshold is 1e-5", () => {
    expect(diffThreshold("white_text")).toBe(1e-5);
  });

  test("render_mode_3 threshold is 1e-7", () => {
    expect(diffThreshold("render_mode_3")).toBe(1e-7);
  });

  test("visible_positive_control threshold is Infinity", () => {
    expect(diffThreshold("visible_positive_control")).toBe(Infinity);
  });
});

describe("computeOverall", () => {
  test("NOT_TESTED when pdfJsRenderPassed is null (client validation not yet posted)", () => {
    const result = computeOverall(
      baseParts({ pdfJsRenderPassed: null, changedPixelRatio: null }),
      "white_text",
    );
    expect(result).toBe("NOT_TESTED");
  });

  test("PASS when everything is clean", () => {
    const result = computeOverall(baseParts(), "white_text");
    expect(result).toBe("PASS");
  });

  test("FAIL when output failed to load", () => {
    const result = computeOverall(baseParts({ outputLoadPassed: false }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("FAIL when page count not preserved", () => {
    const result = computeOverall(baseParts({ pageCountPreserved: false }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("FAIL when page geometry not preserved", () => {
    const result = computeOverall(baseParts({ pageGeometryPreserved: false }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("FAIL when pdfJsRenderPassed is false", () => {
    const result = computeOverall(baseParts({ pdfJsRenderPassed: false }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("FAIL when mode is white_text and hiddenTextExtracted is false", () => {
    const result = computeOverall(baseParts({ hiddenTextExtracted: false }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("PASS_WITH_WARNINGS (not FAIL) when mode is render_mode_3 and hiddenTextExtracted is false", () => {
    const result = computeOverall(baseParts({ hiddenTextExtracted: false }), "render_mode_3");
    expect(result).toBe("PASS_WITH_WARNINGS");
  });

  test("FAIL when changedPixelRatio exceeds mode threshold", () => {
    const result = computeOverall(baseParts({ changedPixelRatio: 1e-4 }), "white_text");
    expect(result).toBe("FAIL");
  });

  test("PASS when changedPixelRatio is within threshold", () => {
    const result = computeOverall(baseParts({ changedPixelRatio: 1e-6 }), "white_text");
    expect(result).toBe("PASS");
  });

  test("visible_positive_control never fails on pixel ratio (threshold Infinity)", () => {
    const result = computeOverall(
      baseParts({ changedPixelRatio: 0.5 }),
      "visible_positive_control",
    );
    expect(result).toBe("PASS");
  });

  test("xmp_only threshold is 1e-7", () => {
    expect(diffThreshold("xmp_only")).toBe(1e-7);
  });

  test("xmp_only PASSes when metadataPayloadPresent is true (hiddenTextExtracted not required)", () => {
    const result = computeOverall(
      baseParts({ hiddenTextExtracted: false, metadataPayloadPresent: true }),
      "xmp_only",
    );
    expect(result).toBe("PASS");
  });

  test("xmp_only FAILs when metadataPayloadPresent is false", () => {
    const result = computeOverall(baseParts({ metadataPayloadPresent: false }), "xmp_only");
    expect(result).toBe("FAIL");
  });

  test("xmp_only FAILs when metadataPayloadPresent is null (not yet checked)", () => {
    const result = computeOverall(baseParts({ metadataPayloadPresent: null }), "xmp_only");
    expect(result).toBe("FAIL");
  });

  test("PASS_WITH_WARNINGS when server validation has warnings", () => {
    const result = computeOverall(baseParts({ hasServerWarnings: true }), "white_text");
    expect(result).toBe("PASS_WITH_WARNINGS");
  });

  test("PASS_WITH_WARNINGS when qpdfStatus is warning", () => {
    const result = computeOverall(baseParts({ qpdfStatus: "warning" }), "white_text");
    expect(result).toBe("PASS_WITH_WARNINGS");
  });

  test("FAIL takes precedence over PASS_WITH_WARNINGS conditions", () => {
    const result = computeOverall(
      baseParts({ outputLoadPassed: false, hasServerWarnings: true }),
      "white_text",
    );
    expect(result).toBe("FAIL");
  });
});
