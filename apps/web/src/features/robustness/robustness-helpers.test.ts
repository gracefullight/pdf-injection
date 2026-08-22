import { describe, expect, it } from "bun:test";
import {
  availabilityLabel,
  formatPercent,
  geometryLabel,
  isLocalProvider,
  parseCustomTexts,
  pdfTransformAvailability,
  providerAvailability,
  shouldPollRun,
} from "@/features/robustness/robustness-helpers";

const OLLAMA_UNAVAILABLE = { available: false, baseUrl: "http://localhost:11434" };
const OLLAMA_AVAILABLE = { available: true, baseUrl: "http://localhost:11434" };

describe("shouldPollRun", () => {
  it("polls while queued or running, stops on terminal statuses", () => {
    expect(shouldPollRun("queued")).toBe(true);
    expect(shouldPollRun("running")).toBe(true);
    expect(shouldPollRun("completed")).toBe(false);
    expect(shouldPollRun("failed")).toBe(false);
    expect(shouldPollRun("cancelled")).toBe(false);
    expect(shouldPollRun(null)).toBe(false);
    expect(shouldPollRun(undefined)).toBe(false);
  });
});

describe("formatPercent", () => {
  it("formats a rate and an em dash for null", () => {
    expect(formatPercent(0.4)).toBe("40.0%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("availabilityLabel", () => {
  it("reports available without a reason", () => {
    expect(availabilityLabel(true)).toBe("Available");
  });

  it("reports unavailable with a reason when given", () => {
    expect(availabilityLabel(false, "no canvas")).toBe("Unavailable — no canvas");
  });

  it("reports unavailable without a reason when none given", () => {
    expect(availabilityLabel(false)).toBe("Unavailable");
  });
});

describe("geometryLabel", () => {
  it("maps true/false/null", () => {
    expect(geometryLabel(true)).toBe("Preserved");
    expect(geometryLabel(false)).toBe("Changed");
    expect(geometryLabel(null)).toBe("—");
  });
});

describe("pdfTransformAvailability", () => {
  it("print_to_pdf requires canvas", () => {
    expect(
      pdfTransformAvailability("print_to_pdf", { canvasAvailable: false, ocrAvailable: true })
        .available,
    ).toBe(false);
    expect(
      pdfTransformAvailability("print_to_pdf", { canvasAvailable: true, ocrAvailable: false })
        .available,
    ).toBe(true);
  });

  it("ocr_regeneration requires both canvas and ocr", () => {
    expect(
      pdfTransformAvailability("ocr_regeneration", { canvasAvailable: true, ocrAvailable: false })
        .available,
    ).toBe(false);
    expect(
      pdfTransformAvailability("ocr_regeneration", { canvasAvailable: false, ocrAvailable: true })
        .available,
    ).toBe(false);
    expect(
      pdfTransformAvailability("ocr_regeneration", { canvasAvailable: true, ocrAvailable: true })
        .available,
    ).toBe(true);
  });
});

describe("providerAvailability", () => {
  it("mock is always available; others need externalProviders on", () => {
    expect(
      providerAvailability("mock", { externalProviders: false, ollama: OLLAMA_UNAVAILABLE })
        .available,
    ).toBe(true);
    expect(
      providerAvailability("anthropic", { externalProviders: false, ollama: OLLAMA_UNAVAILABLE })
        .available,
    ).toBe(false);
    expect(
      providerAvailability("anthropic", { externalProviders: true, ollama: OLLAMA_UNAVAILABLE })
        .available,
    ).toBe(true);
  });

  it("ollama is gated by its own detection, independent of externalProviders", () => {
    expect(
      providerAvailability("ollama", { externalProviders: false, ollama: OLLAMA_UNAVAILABLE })
        .available,
    ).toBe(false);
    expect(
      providerAvailability("ollama", { externalProviders: false, ollama: OLLAMA_AVAILABLE })
        .available,
    ).toBe(true);
    expect(
      providerAvailability("ollama", { externalProviders: false, ollama: OLLAMA_UNAVAILABLE })
        .reason,
    ).toContain("http://localhost:11434");
  });
});

describe("isLocalProvider", () => {
  it("mock and ollama are local; anthropic/openai are not", () => {
    expect(isLocalProvider("mock")).toBe(true);
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("anthropic")).toBe(false);
    expect(isLocalProvider("openai")).toBe(false);
  });
});

describe("parseCustomTexts", () => {
  it("splits on newlines, trims, and drops empty lines", () => {
    expect(parseCustomTexts("first line\n\n  second line  \nthird\n")).toEqual([
      "first line",
      "second line",
      "third",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseCustomTexts("   \n\n  ")).toEqual([]);
  });
});
