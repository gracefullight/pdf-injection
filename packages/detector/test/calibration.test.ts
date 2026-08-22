import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { binomialTestVsBaseline, calibrateBaseline, evaluateCandidate } from "../src/calibration";

describe("binomialTestVsBaseline", () => {
  test("k=0 -> p=1 (P(X>=0) is always 1)", () => {
    expect(binomialTestVsBaseline(0, 10, 0.5)).toBe(1);
  });

  test("k>n -> p=0 (impossible)", () => {
    expect(binomialTestVsBaseline(11, 10, 0.5)).toBe(0);
  });

  test("p0=0, k>0 -> p=0", () => {
    expect(binomialTestVsBaseline(1, 5, 0)).toBe(0);
  });

  test("p0=1, k<=n -> p=1", () => {
    expect(binomialTestVsBaseline(3, 5, 1)).toBe(1);
  });

  test("known value: P(X>=1) for n=1,p0=0.1 equals 0.1", () => {
    expect(binomialTestVsBaseline(1, 1, 0.1)).toBeCloseTo(0.1, 10);
  });

  test("known value: P(X>=8) for n=10,p0=0.5 equals sum(C(10,8..10))/1024 = 56/1024", () => {
    expect(binomialTestVsBaseline(8, 10, 0.5)).toBeCloseTo(56 / 1024, 8);
  });
});

describe("calibrateBaseline", () => {
  const signals: ExpectedSignal[] = [
    { type: "exact_phrase", value: "hidden phrase", caseSensitive: false },
    { type: "methodology_label", value: "Method C", aliases: [] },
  ];

  test("computes per-signal baseline rate, combined score distribution, and false-positive rate", () => {
    const baselineTexts = [
      "hidden phrase and Method C",
      "just Method C here",
      "nothing relevant at all",
    ];
    const result = calibrateBaseline(signals, baselineTexts);

    expect(result.baselineCount).toBe(3);
    expect(result.perSignalBaselineRate[0]!.rate).toBeCloseTo(1 / 3, 10); // "hidden phrase"
    expect(result.perSignalBaselineRate[1]!.rate).toBeCloseTo(2 / 3, 10); // "Method C"
    expect(result.combinedScores.length).toBe(3);
    expect(result.combinedScoreMean).not.toBeNull();
    expect(result.allMatchedCount).toBe(1); // only the first text matches both
    expect(result.falsePositiveRate).toBeCloseTo(1 / 3, 10);
  });

  test("empty baselines -> null means/rates, no throw", () => {
    const result = calibrateBaseline(signals, []);
    expect(result.baselineCount).toBe(0);
    expect(result.combinedScoreMean).toBeNull();
    expect(result.falsePositiveRate).toBeNull();
    expect(result.perSignalBaselineRate.every((r) => r.rate === null)).toBe(true);
  });
});

describe("evaluateCandidate", () => {
  const signals: ExpectedSignal[] = [
    { type: "exact_phrase", value: "hidden phrase", caseSensitive: false },
  ];

  test("insufficient_baseline when calibration has zero baselines", () => {
    const calibration = calibrateBaseline(signals, []);
    const result = evaluateCandidate(signals, "hidden phrase present", calibration);
    expect(result.method).toBe("insufficient_baseline");
    expect(result.pValue).toBeNull();
    expect(result.holmAdjustedPValue).toBeNull();
    expect(result.scores.combined).toBeGreaterThan(0);
  });

  test("binomial_vs_baseline with a computed p-value when baselines exist", () => {
    const baselineTexts = ["nothing relevant", "still nothing", "again nothing"];
    const calibration = calibrateBaseline(signals, baselineTexts);
    expect(calibration.falsePositiveRate).toBe(0);

    const result = evaluateCandidate(signals, "hidden phrase present", calibration);
    expect(result.method).toBe("binomial_vs_baseline");
    // allMatched=true, n=1, p0=0 -> P(X>=1)=0
    expect(result.pValue).toBe(0);
    expect(result.holmAdjustedPValue).toBeNull();
  });

  test("never throws when signals array is empty", () => {
    const calibration = calibrateBaseline([], ["a", "b"]);
    const result = evaluateCandidate([], "anything", calibration);
    expect(result.method).toBe("insufficient_baseline");
  });
});
