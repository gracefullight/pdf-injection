import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { matchSignals } from "../src/match-signals";

describe("matchSignals", () => {
  test("reports per-signal match evidence for a mix of signal types", () => {
    const signals: ExpectedSignal[] = [
      { type: "exact_phrase", value: "F1-score", caseSensitive: true },
      { type: "methodology_label", value: "Method C", aliases: ["method c", "the third method"] },
      { type: "ordered_terms", values: ["robustness", "limitations"] },
    ];
    const text = "We used Method C. We report F1-score. We discuss robustness before limitations.";

    const report = matchSignals(signals, text);

    expect(report.total).toBe(3);
    expect(report.matchedCount).toBe(3);
    expect(report.results).toHaveLength(3);
    for (const entry of report.results) {
      expect(entry.matched).toBe(true);
      expect(entry.evidence).toBeDefined();
    }
  });

  test("reports unmatched signals as matched:false with evidence, not thrown errors", () => {
    const signals: ExpectedSignal[] = [
      { type: "exact_phrase", value: "nonexistent phrase", caseSensitive: true },
    ];
    const report = matchSignals(signals, "some unrelated submission text");
    expect(report.matchedCount).toBe(0);
    expect(report.results[0]?.matched).toBe(false);
  });

  test("an invalid regex signal is reported as unmatched with an error in evidence, never throws", () => {
    const signals: ExpectedSignal[] = [{ type: "regex", pattern: "(unclosed", flags: "i" }];
    expect(() => matchSignals(signals, "text")).not.toThrow();
    const report = matchSignals(signals, "text");
    expect(report.results[0]?.matched).toBe(false);
    expect((report.results[0]!.evidence as { error?: string }).error).toBeDefined();
  });

  test("a section_order signal reports headings evidence", () => {
    const signals: ExpectedSignal[] = [
      { type: "section_order", values: ["Introduction", "Results"] },
    ];
    const text = "# Introduction\nSome text.\n\n# Results\nFinal text.";
    const report = matchSignals(signals, text);
    expect(report.results[0]?.matched).toBe(true);
  });

  test("empty signals list returns an empty report", () => {
    const report = matchSignals([], "any text");
    expect(report.total).toBe(0);
    expect(report.matchedCount).toBe(0);
    expect(report.results).toEqual([]);
  });

  test("empty submission text never throws and reports no matches", () => {
    const signals: ExpectedSignal[] = [
      { type: "exact_phrase", value: "x", caseSensitive: false },
      { type: "ordered_terms", values: ["a", "b"] },
    ];
    expect(() => matchSignals(signals, "")).not.toThrow();
    const report = matchSignals(signals, "");
    expect(report.matchedCount).toBe(0);
  });

  test("result type contains no cheating/AI-detected verdict field", () => {
    const signals: ExpectedSignal[] = [{ type: "exact_phrase", value: "x", caseSensitive: false }];
    const report = matchSignals(signals, "x");
    const keys = Object.keys(report);
    expect(keys).not.toContain("aiDetected");
    expect(keys).not.toContain("verdict");
    expect(keys).not.toContain("cheatingDetected");
    for (const entry of report.results) {
      expect(Object.keys(entry)).not.toContain("verdict");
    }
  });
});
