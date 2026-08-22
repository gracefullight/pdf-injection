import type { ExpectedSignal } from "@pdf-injection/contracts";
import { matchSignals } from "./match-signals";

/**
 * Phase 4 evidence group (PRD §26 Phase 4 / API contract §3
 * `SubmissionAnalysis.signals[].group`).
 */
export type SignalGroup = "methodology" | "lexical" | "structural";

const GROUPS: readonly SignalGroup[] = ["methodology", "lexical", "structural"];

/**
 * Maps an `ExpectedSignal` to its Phase 4 evidence group:
 * `methodology_label` -> methodology; `exact_phrase`/`regex` -> lexical;
 * `ordered_terms`/`section_order` -> structural.
 */
export function signalGroup(signal: ExpectedSignal): SignalGroup {
  switch (signal.type) {
    case "methodology_label":
      return "methodology";
    case "exact_phrase":
    case "regex":
      return "lexical";
    case "ordered_terms":
    case "section_order":
      return "structural";
  }
}

export interface SignalGroupWeights {
  methodology?: number;
  lexical?: number;
  structural?: number;
}

/**
 * Default per-group weight. Used both as the weight assigned to every
 * signal within that group (so, by default, a group's score is a plain
 * matched-fraction) and as that group's weight when combining group scores
 * into `scores.combined` (a weighted mean).
 */
export const DEFAULT_SIGNAL_GROUP_WEIGHTS: Required<SignalGroupWeights> = {
  methodology: 1,
  lexical: 1,
  structural: 1,
};

export interface ScoredSignal {
  index: number;
  signal: ExpectedSignal;
  group: SignalGroup;
  matched: boolean;
  /** Matcher-specific evidence (positions, headings, matchedTerm, error, ...). Never a verdict field. */
  evidence: Record<string, unknown>;
  weight: number;
}

export interface SubmissionScores {
  /** 0..1, weighted matched fraction within the methodology group (0 if the group is empty). */
  methodology: number;
  /** 0..1, weighted matched fraction within the lexical group (0 if the group is empty). */
  lexical: number;
  /** 0..1, weighted matched fraction within the structural group (0 if the group is empty). */
  structural: number;
  /** 0..1, weighted mean of the *present* (non-empty) groups' scores. */
  combined: number;
}

export interface ScoreSubmissionOptions {
  weights?: SignalGroupWeights;
}

export interface ScoreSubmissionResult {
  perSignal: ScoredSignal[];
  scores: SubmissionScores;
}

/**
 * Phase 4 submission scoring (PRD §26 Phase 4, API contract §3
 * `SubmissionAnalysis.scores`). Runs every deterministic matcher in this
 * package (`match-signals.ts`) once and aggregates matches into
 * methodology / lexical / structural group scores and a combined score.
 *
 * IMPORTANT: exactly like `matchSignals()`, this is NOT an "AI detected" /
 * "cheating detected" verdict. A high combined score means more of the
 * configured deterministic signals matched in this text — it is evidence a
 * human reviewer can inspect, not proof of anything about how the text was
 * produced. Alternative explanations (the student was taught this
 * methodology in class, coincidental phrasing, etc.) are always possible;
 * see `calibration.ts` for false-positive-rate context and the API
 * contract's `SubmissionAnalysis.interpretation.alternatives`.
 */
export function scoreSubmission(
  signals: ExpectedSignal[],
  text: string,
  options: ScoreSubmissionOptions = {},
): ScoreSubmissionResult {
  const weights: Required<SignalGroupWeights> = {
    ...DEFAULT_SIGNAL_GROUP_WEIGHTS,
    ...options.weights,
  };
  const report = matchSignals(signals, text);

  const perSignal: ScoredSignal[] = report.results.map((entry, index) => {
    const group = signalGroup(entry.signal);
    return {
      index,
      signal: entry.signal,
      group,
      matched: entry.matched,
      evidence: entry.evidence,
      weight: weights[group],
    };
  });

  const groupMatchedWeight: Record<SignalGroup, number> = {
    methodology: 0,
    lexical: 0,
    structural: 0,
  };
  const groupTotalWeight: Record<SignalGroup, number> = {
    methodology: 0,
    lexical: 0,
    structural: 0,
  };
  const groupPresent: Record<SignalGroup, boolean> = {
    methodology: false,
    lexical: false,
    structural: false,
  };

  for (const s of perSignal) {
    groupPresent[s.group] = true;
    groupTotalWeight[s.group] += s.weight;
    if (s.matched) groupMatchedWeight[s.group] += s.weight;
  }

  const groupScore: Record<SignalGroup, number> = { methodology: 0, lexical: 0, structural: 0 };
  for (const g of GROUPS) {
    groupScore[g] = groupTotalWeight[g] > 0 ? groupMatchedWeight[g] / groupTotalWeight[g] : 0;
  }

  let combinedNumerator = 0;
  let combinedDenominator = 0;
  for (const g of GROUPS) {
    if (!groupPresent[g]) continue;
    combinedNumerator += groupScore[g] * weights[g];
    combinedDenominator += weights[g];
  }
  const combined = combinedDenominator > 0 ? combinedNumerator / combinedDenominator : 0;

  return {
    perSignal,
    scores: {
      methodology: groupScore.methodology,
      lexical: groupScore.lexical,
      structural: groupScore.structural,
      combined,
    },
  };
}
