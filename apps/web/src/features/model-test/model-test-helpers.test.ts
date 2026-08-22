import { describe, expect, it } from "bun:test";
import type { ModelTestAggregate, SmokeTestGate } from "@pdf-injection/contracts";
import {
  deriveGateCardView,
  formatDeltaPp,
  formatLatency,
  formatPercent,
  nextPollingState,
  providerAvailability,
  shouldPollRun,
  sortAggregates,
} from "@/features/model-test/model-test-helpers";

describe("shouldPollRun", () => {
  it("polls while queued or running", () => {
    expect(shouldPollRun("queued")).toBe(true);
    expect(shouldPollRun("running")).toBe(true);
  });

  it("stops polling on terminal statuses", () => {
    expect(shouldPollRun("completed")).toBe(false);
    expect(shouldPollRun("failed")).toBe(false);
    expect(shouldPollRun("cancelled")).toBe(false);
  });

  it("does not poll when there is no run yet", () => {
    expect(shouldPollRun(null)).toBe(false);
    expect(shouldPollRun(undefined)).toBe(false);
  });
});

describe("nextPollingState", () => {
  it("stays idle with no run yet", () => {
    expect(nextPollingState("idle", null)).toBe("idle");
  });

  it("resets a previously-polling state to idle when the run disappears (e.g. after delete)", () => {
    expect(nextPollingState("polling", null)).toBe("idle");
  });

  it("moves to polling while the run is queued/running", () => {
    expect(nextPollingState("idle", "queued")).toBe("polling");
    expect(nextPollingState("polling", "running")).toBe("polling");
  });

  it("moves to done once the run reaches a terminal status", () => {
    expect(nextPollingState("polling", "completed")).toBe("done");
    expect(nextPollingState("polling", "failed")).toBe("done");
    expect(nextPollingState("polling", "cancelled")).toBe("done");
  });
});

describe("formatPercent / formatDeltaPp / formatLatency", () => {
  it("formats a rate as a percentage with one decimal", () => {
    expect(formatPercent(0.873)).toBe("87.3%");
  });

  it("formats null as an em dash", () => {
    expect(formatPercent(null)).toBe("—");
  });

  it("formats a positive delta with an explicit + sign", () => {
    expect(formatDeltaPp(62.5)).toBe("+62.5 pp");
  });

  it("formats a negative delta without a double sign", () => {
    expect(formatDeltaPp(-4.2)).toBe("-4.2 pp");
  });

  it("formats null delta as an em dash", () => {
    expect(formatDeltaPp(null)).toBe("—");
  });

  it("rounds latency to the nearest millisecond", () => {
    expect(formatLatency(1234.6)).toBe("1235 ms");
  });
});

describe("sortAggregates", () => {
  it("sorts by provider then condition", () => {
    const aggregates: ModelTestAggregate[] = [
      {
        provider: "openai",
        condition: "original",
        n: 1,
        allSignalsRate: 0,
        anySignalRate: 0,
        disclosureRate: 0,
        refusalRate: 0,
        meanLatencyMs: 0,
        deltaVsOriginalPp: null,
      },
      {
        provider: "anthropic",
        condition: "white_text",
        n: 1,
        allSignalsRate: 0,
        anySignalRate: 0,
        disclosureRate: 0,
        refusalRate: 0,
        meanLatencyMs: 0,
        deltaVsOriginalPp: 60,
      },
      {
        provider: "anthropic",
        condition: "original",
        n: 1,
        allSignalsRate: 0,
        anySignalRate: 0,
        disclosureRate: 0,
        refusalRate: 0,
        meanLatencyMs: 0,
        deltaVsOriginalPp: null,
      },
    ];
    const sorted = sortAggregates(aggregates);
    expect(sorted.map((a) => `${a.provider}/${a.condition}`)).toEqual([
      "anthropic/original",
      "anthropic/white_text",
      "openai/original",
    ]);
  });

  it("does not mutate the input array", () => {
    const aggregates: ModelTestAggregate[] = [
      {
        provider: "openai",
        condition: "original",
        n: 1,
        allSignalsRate: 0,
        anySignalRate: 0,
        disclosureRate: 0,
        refusalRate: 0,
        meanLatencyMs: 0,
        deltaVsOriginalPp: null,
      },
      {
        provider: "anthropic",
        condition: "original",
        n: 1,
        allSignalsRate: 0,
        anySignalRate: 0,
        disclosureRate: 0,
        refusalRate: 0,
        meanLatencyMs: 0,
        deltaVsOriginalPp: null,
      },
    ];
    const original = [...aggregates];
    sortAggregates(aggregates);
    expect(aggregates).toEqual(original);
  });
});

describe("deriveGateCardView", () => {
  const baseGate: SmokeTestGate = {
    threshold: 50,
    best: { provider: "mock", condition: "white_text", deltaPp: 62.5 },
    passed: true,
    positiveControlRate: 0.95,
    originalFalsePositiveRate: 0.02,
    disclosureRateInjected: 0.05,
    variationAcrossRepeats: 0.12,
  };

  it("reports a passing gate with the threshold and best condition", () => {
    const view = deriveGateCardView(baseGate);
    expect(view.passed).toBe(true);
    expect(view.headline).toBe("Smoke-test gate passed (≥ 50 pp)");
    expect(view.bestLabel).toBe("mock / white_text: +62.5 pp");
    expect(view.positiveControlLabel).toBe("95.0%");
    expect(view.originalFpLabel).toBe("2.0%");
    expect(view.disclosureLabel).toBe("5.0%");
    expect(view.variationLabel).toBe("0.120");
  });

  it("reports a failing gate with no comparable condition", () => {
    const view = deriveGateCardView({
      ...baseGate,
      passed: false,
      best: null,
      variationAcrossRepeats: null,
    });
    expect(view.passed).toBe(false);
    expect(view.headline).toBe("Smoke-test gate not met (< 50 pp)");
    expect(view.bestLabel).toBe("No comparable condition recorded yet");
    expect(view.variationLabel).toBe("—");
  });
});

describe("providerAvailability", () => {
  it("mock is always available", () => {
    expect(providerAvailability("mock", { externalProviders: false })).toEqual({
      available: true,
      reason: null,
    });
    expect(providerAvailability("mock", { externalProviders: true })).toEqual({
      available: true,
      reason: null,
    });
  });

  it("anthropic/openai are unavailable with a reason when externalProviders is off", () => {
    const result = providerAvailability("anthropic", { externalProviders: false });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("PS_ALLOW_EXTERNAL_PROVIDERS");
  });

  it("anthropic/openai are available (pending server-side key check) when externalProviders is on", () => {
    expect(providerAvailability("openai", { externalProviders: true })).toEqual({
      available: true,
      reason: null,
    });
  });
});
