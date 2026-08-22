import type { ExpectedSignal } from "@pdf-injection/contracts";
import { logChoose } from "./log-math";
import { matchSignals } from "./match-signals";
import { type ScoreSubmissionOptions, type SubmissionScores, scoreSubmission } from "./scoring";

export interface PerSignalBaselineRate {
  index: number;
  /** Fraction of baseline texts this signal matched, or null when there are no baselines. */
  rate: number | null;
}

export interface CalibrateBaselineResult {
  baselineCount: number;
  perSignalBaselineRate: PerSignalBaselineRate[];
  /** `scoreSubmission(...).scores.combined` for every baseline text, in input order. */
  combinedScores: number[];
  combinedScoreMean: number | null;
  /** Fraction of baselines where EVERY expected signal matched. */
  falsePositiveRate: number | null;
  allMatchedCount: number;
}

/**
 * PRD §26 Phase 4 / API contract §3: computes false-positive calibration
 * statistics for a set of `signals` against a set of known-original
 * `baselineTexts` (texts that should NOT trigger the signals, since they
 * were not exposed to the hidden instruction). `falsePositiveRate` is the
 * fraction of baselines where every signal happened to match anyway.
 */
export function calibrateBaseline(
  signals: ExpectedSignal[],
  baselineTexts: string[],
  options: ScoreSubmissionOptions = {},
): CalibrateBaselineResult {
  const baselineCount = baselineTexts.length;

  if (baselineCount === 0) {
    return {
      baselineCount,
      perSignalBaselineRate: signals.map((_, index) => ({ index, rate: null })),
      combinedScores: [],
      combinedScoreMean: null,
      falsePositiveRate: null,
      allMatchedCount: 0,
    };
  }

  const perSignalMatchCounts = signals.map(() => 0);
  const combinedScores: number[] = [];
  let allMatchedCount = 0;

  for (const text of baselineTexts) {
    const report = matchSignals(signals, text);
    report.results.forEach((r, i) => {
      if (r.matched) perSignalMatchCounts[i] = (perSignalMatchCounts[i] ?? 0) + 1;
    });
    if (signals.length > 0 && report.matchedCount === report.total) allMatchedCount++;
    combinedScores.push(scoreSubmission(signals, text, options).scores.combined);
  }

  const perSignalBaselineRate: PerSignalBaselineRate[] = perSignalMatchCounts.map(
    (count, index) => ({
      index,
      rate: count / baselineCount,
    }),
  );

  const combinedScoreMean = combinedScores.reduce((sum, s) => sum + s, 0) / combinedScores.length;
  const falsePositiveRate = signals.length > 0 ? allMatchedCount / baselineCount : null;

  return {
    baselineCount,
    perSignalBaselineRate,
    combinedScores,
    combinedScoreMean,
    falsePositiveRate,
    allMatchedCount,
  };
}

/**
 * Exact one-sided (upper-tail) binomial test: `P(X >= k)` for `X ~
 * Binomial(n, p0)`. Asks "how surprising would it be to observe `k` or
 * more 'successes' out of `n` trials if the true success probability were
 * the baseline rate `p0`?" A small p-value is evidence the observed rate
 * is unusually high relative to baseline — never proof on its own (see
 * `match-signals.ts` JSDoc).
 *
 * Handles the degenerate `p0` boundary cases (`0` and `1`) directly rather
 * than through `Math.log`, since `log(0)` is `-Infinity`.
 */
export function binomialTestVsBaseline(k: number, n: number, p0: number): number {
  if (n <= 0) return Number.NaN;
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p0 <= 0) return 0;
  if (p0 >= 1) return 1;

  const logP0 = Math.log(p0);
  const log1mP0 = Math.log(1 - p0);
  let p = 0;
  for (let i = k; i <= n; i++) {
    p += Math.exp(logChoose(n, i) + i * logP0 + (n - i) * log1mP0);
  }
  return Math.min(1, p);
}

export type CalibrationMethod = "binomial_vs_baseline" | "insufficient_baseline";

export interface EvaluateCandidateResult {
  scores: SubmissionScores;
  pValue: number | null;
  holmAdjustedPValue: number | null;
  method: CalibrationMethod;
}

/**
 * PRD §26 Phase 4 / API contract §3 `SubmissionAnalysis.calibration`:
 * scores a single candidate submission (`scoreSubmission()`) and compares
 * its "every expected signal matched" outcome — a single Bernoulli trial
 * (n=1) — against the baseline false-positive rate via an exact one-sided
 * binomial test.
 *
 * `holmAdjustedPValue` is always `null` here: Holm-Bonferroni correction
 * (`statistics.ts` `holmBonferroni()`) requires the full family of
 * p-values across every submission being compared in one job, which this
 * single-candidate function does not have access to. A caller evaluating a
 * batch of candidates (e.g. apps/api's submissions service) should collect
 * every `pValue` from repeated `evaluateCandidate()` calls and pass them
 * together to `holmBonferroni()` to fill in the adjusted value.
 *
 * `method` is `"insufficient_baseline"` (and `pValue` stays `null`) when
 * there are no baseline texts, no configured signals, or the baseline's
 * false-positive rate could not be computed.
 */
export function evaluateCandidate(
  signals: ExpectedSignal[],
  candidateText: string,
  calibration: CalibrateBaselineResult,
  options: ScoreSubmissionOptions = {},
): EvaluateCandidateResult {
  const { scores } = scoreSubmission(signals, candidateText, options);

  if (
    signals.length === 0 ||
    calibration.baselineCount === 0 ||
    calibration.falsePositiveRate === null
  ) {
    return { scores, pValue: null, holmAdjustedPValue: null, method: "insufficient_baseline" };
  }

  const report = matchSignals(signals, candidateText);
  const allMatched = report.total > 0 && report.matchedCount === report.total;
  const pValue = binomialTestVsBaseline(allMatched ? 1 : 0, 1, calibration.falsePositiveRate);

  return { scores, pValue, holmAdjustedPValue: null, method: "binomial_vs_baseline" };
}
