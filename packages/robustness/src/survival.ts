// Signal survival evaluation for robustness runs (contract §4:
// `textResults[].samples[]` / `survivalRate`): did the expected signals
// still match after a transform was applied? Deterministic evidence only —
// see @pdf-injection/detector's match-signals.ts caveat, which applies here
// too: this is not a verdict, just a before/after evidence count.
import type { ExpectedSignal } from "@pdf-injection/contracts";
import { matchSignals } from "@pdf-injection/detector";

export interface SurvivalEvaluation {
  signalsBefore: number;
  signalsAfter: number;
  allMatchedBefore: boolean;
  allMatchedAfter: boolean;
}

export function evaluateSurvival(
  signals: ExpectedSignal[],
  before: string,
  after: string,
): SurvivalEvaluation {
  const beforeReport = matchSignals(signals, before);
  const afterReport = matchSignals(signals, after);
  return {
    signalsBefore: beforeReport.matchedCount,
    signalsAfter: afterReport.matchedCount,
    allMatchedBefore: signals.length > 0 && beforeReport.matchedCount === beforeReport.total,
    allMatchedAfter: signals.length > 0 && afterReport.matchedCount === afterReport.total,
  };
}

/**
 * Fraction of samples where every expected signal still matched after the
 * transform (contract §4: `RobustnessRun.textResults[].survivalRate`).
 * `null` for an empty sample set (nothing to report a rate over).
 */
export function survivalRate(samples: SurvivalEvaluation[]): number | null {
  if (samples.length === 0) return null;
  const survived = samples.filter((s) => s.allMatchedAfter).length;
  return survived / samples.length;
}
