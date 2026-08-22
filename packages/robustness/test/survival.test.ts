import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { evaluateSurvival, survivalRate } from "../src/survival";

const SIGNALS: ExpectedSignal[] = [
  { type: "exact_phrase", value: "Method C", caseSensitive: true },
  { type: "ordered_terms", values: ["robustness", "limitations"] },
];

describe("evaluateSurvival", () => {
  test("reports full survival when all signals still match after a transform", () => {
    const before = "We used Method C. We discuss robustness before limitations.";
    const after =
      "We used Method C throughout. We discuss robustness before limitations in detail.";
    const evaluation = evaluateSurvival(SIGNALS, before, after);
    expect(evaluation.signalsBefore).toBe(2);
    expect(evaluation.signalsAfter).toBe(2);
    expect(evaluation.allMatchedBefore).toBe(true);
    expect(evaluation.allMatchedAfter).toBe(true);
  });

  test("reports partial survival when a signal is lost after a transform", () => {
    const before = "We used Method C. We discuss robustness before limitations.";
    const after = "We used a different approach entirely, with no mention of the ordering.";
    const evaluation = evaluateSurvival(SIGNALS, before, after);
    expect(evaluation.signalsBefore).toBe(2);
    expect(evaluation.signalsAfter).toBe(0);
    expect(evaluation.allMatchedBefore).toBe(true);
    expect(evaluation.allMatchedAfter).toBe(false);
  });

  test("allMatched* is false for an empty signal set (nothing to assert full survival over)", () => {
    const evaluation = evaluateSurvival([], "anything", "anything else");
    expect(evaluation.allMatchedBefore).toBe(false);
    expect(evaluation.allMatchedAfter).toBe(false);
  });
});

describe("survivalRate", () => {
  test("is the fraction of samples where every signal survived", () => {
    const samples = [
      { signalsBefore: 2, signalsAfter: 2, allMatchedBefore: true, allMatchedAfter: true },
      { signalsBefore: 2, signalsAfter: 1, allMatchedBefore: true, allMatchedAfter: false },
      { signalsBefore: 2, signalsAfter: 2, allMatchedBefore: true, allMatchedAfter: true },
      { signalsBefore: 2, signalsAfter: 0, allMatchedBefore: true, allMatchedAfter: false },
    ];
    expect(survivalRate(samples)).toBe(0.5);
  });

  test("is null for an empty sample set", () => {
    expect(survivalRate([])).toBeNull();
  });
});
