import { describe, expect, it } from "bun:test";
import type { HealthResponse } from "@pdf-injection/contracts";
import { deriveFeatures, FALLBACK_FEATURES, resolveFeatureGateMessage } from "@/lib/features";

function health(
  overrides: Partial<HealthResponse["features"]> = {},
  qpdfAvailable = true,
): HealthResponse {
  return {
    status: "ok",
    version: "test",
    qpdfAvailable,
    features: {
      externalProviders: false,
      researchMode: false,
      ocrAvailable: false,
      canvasAvailable: false,
      koPayload: false,
      ...overrides,
    },
  };
}

describe("deriveFeatures", () => {
  it("returns the conservative fallback when health hasn't loaded", () => {
    expect(deriveFeatures(undefined)).toEqual(FALLBACK_FEATURES);
  });

  it("flattens features + top-level qpdfAvailable", () => {
    expect(deriveFeatures(health({ externalProviders: true, researchMode: true }, true))).toEqual({
      externalProviders: true,
      researchMode: true,
      ocrAvailable: false,
      canvasAvailable: false,
      koPayload: false,
      qpdfAvailable: true,
    });
  });
});

describe("resolveFeatureGateMessage", () => {
  it("names the exact env var for externalProviders, phrased as admin guidance", () => {
    expect(resolveFeatureGateMessage("externalProviders")).toBe(
      "Not available on this server (PDFI_ALLOW_EXTERNAL_PROVIDERS is not set). Ask the operator to set PDFI_ALLOW_EXTERNAL_PROVIDERS=true to enable it.",
    );
  });

  it("names the exact env var for researchMode, phrased as admin guidance", () => {
    expect(resolveFeatureGateMessage("researchMode")).toBe(
      "Not available on this server (PDFI_RESEARCH_MODE is not set). Ask the operator to set PDFI_RESEARCH_MODE=true to enable it.",
    );
  });

  it("falls back to a capability reason for ocrAvailable (no env toggle)", () => {
    expect(resolveFeatureGateMessage("ocrAvailable")).toContain(
      "OCR (tesseract.js) is not available",
    );
  });

  it("falls back to a capability reason for canvasAvailable (no env toggle)", () => {
    expect(resolveFeatureGateMessage("canvasAvailable")).toContain("@napi-rs/canvas");
  });

  it("honors an explicit envVar override", () => {
    expect(resolveFeatureGateMessage("ocrAvailable", "PDFI_CUSTOM_FLAG")).toBe(
      "Not available on this server (PDFI_CUSTOM_FLAG is not set). Ask the operator to set PDFI_CUSTOM_FLAG=true to enable it.",
    );
  });

  it("honors an explicit unavailableReason override when there's no env var", () => {
    expect(resolveFeatureGateMessage("ocrAvailable", undefined, "custom reason")).toBe(
      "custom reason",
    );
  });
});
