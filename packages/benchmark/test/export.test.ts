import { describe, expect, test } from "bun:test";
import type { ModelTestResult, ModelTestRun } from "@pdf-injection/contracts";
import { toCsv, toJson } from "../src/export";

function buildResult(overrides: Partial<ModelTestResult> = {}): ModelTestResult {
  return {
    provider: "mock",
    modelId: "pdf-injection-mock-v1",
    condition: "white_text",
    repeat: 1,
    executedAt: "2026-08-22T00:00:00.000Z",
    outerPromptSha256: "prompt-sha",
    pdfSha256: "pdf-sha",
    rawResponse: "plain response",
    responseSha256: "response-sha",
    signalMatches: [
      {
        signal: { type: "exact_phrase", value: "Method C", caseSensitive: false },
        matched: true,
        evidence: {},
      },
    ],
    allSignalsMatched: true,
    anySignalMatched: true,
    disclosure: false,
    refusal: false,
    latencyMs: 12.5,
    usage: { inputTokens: 100, outputTokens: 50 },
    error: null,
    ...overrides,
  };
}

function buildRun(results: ModelTestResult[]): ModelTestRun {
  return {
    runId: "run-1",
    jobId: "job-1",
    status: "completed",
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:01.000Z",
    config: {
      providers: [{ name: "mock" }],
      conditions: ["original", "white_text"],
      repeats: 1,
      outerPrompt: "Read the attached assignment PDF and produce a complete response.",
      outerPromptSha256: "prompt-sha",
    },
    progress: { done: results.length, total: results.length },
    results,
    aggregates: [],
    smokeTestGate: {
      threshold: 50,
      best: null,
      passed: false,
      positiveControlRate: null,
      originalFalsePositiveRate: null,
      disclosureRateInjected: null,
      variationAcrossRepeats: null,
    },
    interpretation: "test interpretation",
    errorCode: null,
  };
}

describe("toJson", () => {
  test("round-trips the full ModelTestRun", () => {
    const run = buildRun([buildResult()]);
    const json = toJson(run);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(run)));
  });
});

describe("toCsv", () => {
  test("has a header row plus one row per result, and excludes rawResponse by default", () => {
    const run = buildRun([buildResult(), buildResult({ repeat: 2 })]);
    const csv = toCsv(run);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[0]).not.toContain("rawResponse");
    expect(csv).not.toContain("plain response");
  });

  test("includes rawResponse when includeRaw is true", () => {
    const run = buildRun([buildResult()]);
    const csv = toCsv(run, { includeRaw: true });
    expect(csv).toContain("rawResponse");
    expect(csv).toContain("plain response");
  });

  test("RFC 4180-quotes fields containing commas, quotes, or newlines", () => {
    const run = buildRun([buildResult({ error: 'a "quoted", value\nwith a newline' })]);
    const csv = toCsv(run);
    // The quoted field must be wrapped in double quotes with internal quotes doubled.
    expect(csv).toContain('"a ""quoted"", value\nwith a newline"');
  });

  test("empty run still produces a header-only CSV", () => {
    const run = buildRun([]);
    const csv = toCsv(run);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });

  test("includes an ingestion column (round-2 addendum §6), populated when the result has one", () => {
    const run = buildRun([buildResult({ ingestion: "text_extraction" })]);
    const csv = toCsv(run);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("ingestion");
    expect(lines[1]).toContain("text_extraction");
  });

  test("ingestion column is blank when the result predates the field", () => {
    const run = buildRun([buildResult()]);
    const csv = toCsv(run);
    const lines = csv.trim().split("\r\n");
    const headerCols = (lines[0] as string).split(",");
    const rowCols = (lines[1] as string).split(",");
    expect(rowCols[headerCols.indexOf("ingestion")]).toBe("");
  });
});
