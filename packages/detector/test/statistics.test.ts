import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { compareRates, fisherExact2x2, holmBonferroni } from "../src/statistics";

describe("fisherExact2x2", () => {
  test("known value: [[3,1],[1,3]] -> p ~= 0.4857 (two-sided)", () => {
    expect(fisherExact2x2(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
  });

  test("known value: [[8,2],[1,5]] -> p ~= 0.0350 (two-sided)", () => {
    expect(fisherExact2x2(8, 2, 1, 5)).toBeCloseTo(0.035, 3);
  });

  test("identical rates -> p close to 1", () => {
    expect(fisherExact2x2(5, 5, 5, 5)).toBeCloseTo(1, 2);
  });

  test("all-zero row -> does not throw, returns a valid probability", () => {
    const p = fisherExact2x2(0, 0, 3, 2);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  test("rejects negative or non-integer cell counts", () => {
    expect(() => fisherExact2x2(-1, 0, 0, 0)).toThrow();
    expect(() => fisherExact2x2(1.5, 0, 0, 0)).toThrow();
  });
});

describe("holmBonferroni", () => {
  test("step-down adjustment matches hand-computed example", () => {
    // p = [0.01, 0.02, 0.03, 0.20], m=4
    // sorted: 0.01(rank1,f=4->0.04) 0.02(rank2,f=3->0.06) 0.03(rank3,f=2->0.06, monotonic max(0.06,0.06)=0.06) 0.20(rank4,f=1->0.20)
    const results = holmBonferroni([0.02, 0.01, 0.2, 0.03], 0.05);
    expect(results.length).toBe(4);
    // original index 1 (p=0.01) -> adjusted 0.04, significant (<=0.05)
    expect(results[1]!.p).toBe(0.01);
    expect(results[1]!.adjustedP).toBeCloseTo(0.04, 10);
    expect(results[1]!.significant).toBe(true);
    // original index 0 (p=0.02) -> adjusted 0.06, not significant (>0.05) -> step-down stops
    expect(results[0]!.p).toBe(0.02);
    expect(results[0]!.adjustedP).toBeCloseTo(0.06, 10);
    expect(results[0]!.significant).toBe(false);
    // original index 3 (p=0.03) -> once step-down has failed, all later ranks are not significant
    expect(results[3]!.significant).toBe(false);
    // original index 2 (p=0.2) -> not significant
    expect(results[2]!.significant).toBe(false);
  });

  test("empty input returns empty array, no throw", () => {
    expect(holmBonferroni([], 0.05)).toEqual([]);
  });

  test("adjusted p-values are always non-decreasing by rank (monotonicity enforced)", () => {
    const results = holmBonferroni([0.5, 0.001, 0.4], 0.05);
    const sorted = [...results].sort((a, b) => a.p - b.p);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.adjustedP).toBeGreaterThanOrEqual(sorted[i - 1]!.adjustedP);
    }
  });
});

describe("compareRates", () => {
  const signals: ExpectedSignal[] = [
    { type: "exact_phrase", value: "hidden phrase", caseSensitive: false },
    { type: "methodology_label", value: "Method C", aliases: [] },
  ];

  test("returns per-signal and combined rates with expected shape", () => {
    const candidateTexts = ["hidden phrase and Method C", "hidden phrase only", "neither here"];
    const baselineTexts = ["nothing relevant", "still nothing", "Method C only though"];

    const stats = compareRates(signals, candidateTexts, baselineTexts);
    expect(stats.candidateCount).toBe(3);
    expect(stats.baselineCount).toBe(3);
    expect(stats.familyWiseAlpha).toBe(0.05);
    expect(stats.perSignal.length).toBe(2);

    // signal 0 "hidden phrase": candidate 2/3, baseline 0/3
    expect(stats.perSignal[0]!.candidateRate).toBeCloseTo(2 / 3, 10);
    expect(stats.perSignal[0]!.baselineRate).toBeCloseTo(0, 10);
    expect(stats.perSignal[0]!.fisherExactP).not.toBeNull();
    expect(stats.perSignal[0]!.holmAdjustedP).not.toBeNull();

    expect(stats.combined.deltaPp).not.toBeNull();
  });

  test("empty candidate or baseline -> null rates and an explanatory note, never throws", () => {
    const stats = compareRates(signals, [], ["baseline text"]);
    expect(stats.candidateCount).toBe(0);
    expect(stats.perSignal[0]!.candidateRate).toBeNull();
    expect(stats.perSignal[0]!.fisherExactP).toBeNull();
    expect(stats.combined.deltaPp).toBeNull();
    expect(stats.notes.length).toBeGreaterThan(0);
  });

  test("no signals -> empty perSignal, no throw", () => {
    const stats = compareRates([], ["a"], ["b"]);
    expect(stats.perSignal).toEqual([]);
    expect(stats.notes.length).toBeGreaterThan(0);
  });
});
