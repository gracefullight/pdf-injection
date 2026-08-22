import { describe, expect, test } from "bun:test";
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { DEFAULT_SIGNAL_GROUP_WEIGHTS, scoreSubmission, signalGroup } from "../src/scoring";

describe("signalGroup", () => {
  test("maps each ExpectedSignal.type to its Phase 4 evidence group", () => {
    expect(signalGroup({ type: "methodology_label", value: "Method C", aliases: [] })).toBe(
      "methodology",
    );
    expect(signalGroup({ type: "exact_phrase", value: "x", caseSensitive: true })).toBe("lexical");
    expect(signalGroup({ type: "regex", pattern: "x", flags: "" })).toBe("lexical");
    expect(signalGroup({ type: "ordered_terms", values: ["a", "b"] })).toBe("structural");
    expect(signalGroup({ type: "section_order", values: ["Intro"] })).toBe("structural");
  });
});

describe("scoreSubmission", () => {
  const signals: ExpectedSignal[] = [
    { type: "methodology_label", value: "Method C", aliases: [] }, // methodology
    { type: "exact_phrase", value: "foo bar", caseSensitive: true }, // lexical
    { type: "regex", pattern: "\\bbaz\\b", flags: "gi" }, // lexical
    { type: "ordered_terms", values: ["alpha", "beta"] }, // structural
  ];

  test("perSignal has index/signal/group/matched/evidence/weight for every input signal", () => {
    const { perSignal } = scoreSubmission(signals, "Method C. foo bar. baz. alpha then beta.");
    expect(perSignal.length).toBe(4);
    expect(perSignal[0]!.group).toBe("methodology");
    expect(perSignal[0]!.matched).toBe(true);
    expect(perSignal[1]!.group).toBe("lexical");
    expect(perSignal[2]!.group).toBe("lexical");
    expect(perSignal[3]!.group).toBe("structural");
    for (const s of perSignal) expect(s.weight).toBe(1);
  });

  test("group score is the matched fraction within that group; combined excludes absent groups", () => {
    // methodology: 1/1 matched; lexical: 1/2 matched (regex baz missing); structural: 0/1
    const text = "Method C. foo bar. alpha but not the other term.";
    const { scores } = scoreSubmission(signals, text);
    expect(scores.methodology).toBe(1);
    expect(scores.lexical).toBe(0.5);
    expect(scores.structural).toBe(0);
    // combined = mean of present groups (all 3 present here), equal weights
    expect(scores.combined).toBeCloseTo((1 + 0.5 + 0) / 3, 10);
  });

  test("a group with no signals scores 0 and is excluded from the combined mean", () => {
    const onlyLexical: ExpectedSignal[] = [
      { type: "exact_phrase", value: "hit", caseSensitive: false },
    ];
    const { scores } = scoreSubmission(onlyLexical, "a hit occurred");
    expect(scores.methodology).toBe(0);
    expect(scores.structural).toBe(0);
    expect(scores.lexical).toBe(1);
    // combined is the lexical-only mean, not diluted by absent groups
    expect(scores.combined).toBe(1);
  });

  test("custom group weights change the combined weighted mean but not each group's own fraction", () => {
    const text = "Method C. foo bar. alpha but not the other term.";
    const { scores } = scoreSubmission(signals, text, {
      weights: { methodology: 3, lexical: 1, structural: 1 },
    });
    expect(scores.methodology).toBe(1);
    expect(scores.lexical).toBe(0.5);
    expect(scores.structural).toBe(0);
    // weighted mean: (1*3 + 0.5*1 + 0*1) / (3+1+1) = 3.5/5 = 0.7
    expect(scores.combined).toBeCloseTo(0.7, 10);
  });

  test("no signals at all -> every score is 0, no throw", () => {
    const { scores, perSignal } = scoreSubmission([], "anything");
    expect(perSignal).toEqual([]);
    expect(scores).toEqual({ methodology: 0, lexical: 0, structural: 0, combined: 0 });
  });

  test("DEFAULT_SIGNAL_GROUP_WEIGHTS is exported and uniform", () => {
    expect(DEFAULT_SIGNAL_GROUP_WEIGHTS).toEqual({ methodology: 1, lexical: 1, structural: 1 });
  });
});
