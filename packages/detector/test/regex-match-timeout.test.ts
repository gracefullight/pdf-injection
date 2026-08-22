import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import {
  DEFAULT_REGEX_TIMEOUT_MS,
  MAX_HAYSTACK_LENGTH,
  MAX_REGEX_SIGNALS_PER_CALL,
  matchSignalsAsync,
  regexMatchWithTimeout,
} from "../src/regex-match-timeout";

describe("regexMatchWithTimeout", () => {
  test("aborts a catastrophic alternation pattern the sync heuristic misses, under 300ms total", async () => {
    // (a|aa)+$ is documented in regex-match.ts as NOT caught by the
    // nested-quantifier heuristic; it is a genuine catastrophic-backtracking
    // shape that only a hard wall-clock timeout can bound.
    const pattern = "(a|aa)+$";
    const text = `${"a".repeat(40)}!`;

    const start = performance.now();
    const result = await regexMatchWithTimeout(pattern, "", text, { timeoutMs: 150 });
    const elapsed = performance.now() - start;

    expect(result).toEqual({ matched: false, positions: [], error: "Pattern timed out" });
    expect(elapsed).toBeLessThan(300);
  });

  test("resolves normally (well under the timeout) for a benign pattern", async () => {
    const result = await regexMatchWithTimeout("\\bcat\\b", "gi", "the Cat sat");
    expect(result.matched).toBe(true);
    expect(result.positions).toEqual([4]);
  });

  test("uses DEFAULT_REGEX_TIMEOUT_MS (200) when no timeoutMs is given", () => {
    expect(DEFAULT_REGEX_TIMEOUT_MS).toBe(200);
  });

  test("rejects a haystack over MAX_HAYSTACK_LENGTH without evaluating the pattern", async () => {
    const text = "a".repeat(MAX_HAYSTACK_LENGTH + 1);
    const result = await regexMatchWithTimeout("a+", "", text);
    expect(result.matched).toBe(false);
    expect(result.error).toContain("Haystack exceeds the maximum length");
  });

  test("MAX_HAYSTACK_LENGTH is exported and equals 1_000_000", () => {
    expect(MAX_HAYSTACK_LENGTH).toBe(1_000_000);
  });
});

describe("matchSignalsAsync", () => {
  test("evaluates non-regex signals synchronously (unchanged semantics)", async () => {
    const signals: ExpectedSignal[] = [
      { type: "exact_phrase", value: "hello", caseSensitive: true },
    ];
    const report = await matchSignalsAsync(signals, "hello world");
    expect(report.matchedCount).toBe(1);
    expect(report.total).toBe(1);
    expect(report.results[0]!.matched).toBe(true);
  });

  test("evaluates a regex signal via the worker path", async () => {
    const signals: ExpectedSignal[] = [{ type: "regex", pattern: "\\bworld\\b", flags: "gi" }];
    const report = await matchSignalsAsync(signals, "hello world");
    expect(report.matchedCount).toBe(1);
    expect(report.results[0]!.evidence.positions).toEqual([6]);
  });

  test("caps regex signals at MAX_REGEX_SIGNALS_PER_CALL, erroring extras instead of throwing", async () => {
    const signals: ExpectedSignal[] = Array.from(
      { length: MAX_REGEX_SIGNALS_PER_CALL + 5 },
      (_, i) => ({
        type: "regex" as const,
        pattern: `x${i}`,
        flags: "",
      }),
    );

    const report = await matchSignalsAsync(signals, "no match here");
    expect(report.total).toBe(MAX_REGEX_SIGNALS_PER_CALL + 5);

    const errored = report.results.filter(
      (r) =>
        typeof r.evidence.error === "string" &&
        (r.evidence.error as string).includes("Too many regex signals"),
    );
    expect(errored.length).toBe(5);
  });

  test("never throws for a whole array dominated by pathological patterns; total elapsed stays bounded", async () => {
    const signals: ExpectedSignal[] = [
      { type: "regex", pattern: "(a|aa)+$", flags: "" },
      { type: "exact_phrase", value: "safe", caseSensitive: false },
    ];
    const text = `${"a".repeat(35)}!`;

    const start = performance.now();
    const report = await matchSignalsAsync(signals, text, { timeoutMs: 100 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(300);
    expect(report.results[0]!.matched).toBe(false);
    expect(report.results[0]!.evidence.error).toBe("Pattern timed out");
  });

  test("errors regex signals instead of throwing when haystack exceeds MAX_HAYSTACK_LENGTH, while still running non-regex signals", async () => {
    const text = "a".repeat(MAX_HAYSTACK_LENGTH + 1);
    const signals: ExpectedSignal[] = [
      { type: "regex", pattern: "a+", flags: "" },
      { type: "exact_phrase", value: "a", caseSensitive: true },
    ];
    const report = await matchSignalsAsync(signals, text);
    expect(report.results[0]!.evidence.error).toContain("Haystack exceeds the maximum length");
    expect(report.results[1]!.matched).toBe(true);
  });
});
