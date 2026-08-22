import type { ExpectedSignal } from "@pdf-injection/contracts";
import { logFactorial } from "./log-math";
import { matchSignals } from "./match-signals";

/**
 * log P(A=a) under the (non-central, odds-ratio=1) hypergeometric
 * distribution implied by a 2x2 contingency table's fixed margins.
 */
function hypergeomLogProb(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const r1 = a + b;
  const r2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  return (
    logFactorial(r1) +
    logFactorial(r2) +
    logFactorial(col1) +
    logFactorial(col2) -
    logFactorial(n) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d)
  );
}

/**
 * Two-sided Fisher's exact test for a 2x2 contingency table:
 * ```
 *          matched   not matched
 * group1     a           b
 * group2     c           d
 * ```
 * Implemented via exact enumeration of every table sharing the observed
 * table's row/column margins (log-factorial arithmetic for numerical
 * stability), summing the probability of every table at least as extreme
 * (probability <= the observed table's probability, within a small
 * floating-point tolerance) as the "two-sided" definition.
 *
 * Verified against known reference values: `fisherExact2x2(3,1,1,3)` ~=
 * 0.4857; `fisherExact2x2(8,2,1,5)` ~= 0.0350.
 */
export function fisherExact2x2(a: number, b: number, c: number, d: number): number {
  for (const cell of [a, b, c, d]) {
    if (cell < 0 || !Number.isInteger(cell)) {
      throw new RangeError("fisherExact2x2: all four cell counts must be non-negative integers");
    }
  }

  const r1 = a + b;
  const r2 = c + d;
  const col1 = a + c;

  const observedLogProb = hypergeomLogProb(a, b, c, d);
  const EPS = 1e-9;

  let pValue = 0;
  const aMin = Math.max(0, col1 - r2);
  const aMax = Math.min(r1, col1);
  for (let ai = aMin; ai <= aMax; ai++) {
    const bi = r1 - ai;
    const ci = col1 - ai;
    const di = r2 - ci;
    if (bi < 0 || ci < 0 || di < 0) continue;
    const logProb = hypergeomLogProb(ai, bi, ci, di);
    if (logProb <= observedLogProb + EPS) {
      pValue += Math.exp(logProb);
    }
  }

  return Math.min(1, pValue);
}

export interface HolmResult {
  /** Index into the original (unsorted) `pValues` array. */
  index: number;
  p: number;
  adjustedP: number;
  significant: boolean;
}

/**
 * Holm-Bonferroni step-down multiple-comparison correction (family-wise
 * error rate control). Sorts p-values ascending, multiplies rank `i`
 * (1-indexed) by `(m - i + 1)`, enforces monotonicity (adjusted p-values
 * are non-decreasing by rank), and applies the step-down rule: once a
 * hypothesis fails to be significant at `alpha`, every hypothesis with a
 * larger raw p-value is also not significant, regardless of its own
 * adjusted value.
 *
 * Returns results in the SAME order as the input `pValues` array (each
 * result's `index` also records its original position, for convenience
 * when re-associating with signals/submissions).
 */
export function holmBonferroni(pValues: number[], alpha = 0.05): HolmResult[] {
  const m = pValues.length;
  if (m === 0) return [];

  const indexed = pValues.map((p, index) => ({ p, index }));
  const sortedByP = [...indexed].sort((x, y) => x.p - y.p);

  let runningMax = 0;
  const bySortedRank: HolmResult[] = [];
  let stillSignificant = true;

  for (let rank = 0; rank < m; rank++) {
    const entry = sortedByP[rank]!;
    const rawAdjusted = Math.min(1, entry.p * (m - rank));
    runningMax = Math.max(runningMax, rawAdjusted);

    const significant = stillSignificant && runningMax <= alpha;
    if (!significant) stillSignificant = false;

    bySortedRank.push({ index: entry.index, p: entry.p, adjustedP: runningMax, significant });
  }

  const byOriginalIndex = new Array<HolmResult>(m);
  for (const r of bySortedRank) byOriginalIndex[r.index] = r;
  return byOriginalIndex;
}

export interface PerSignalStatistic {
  index: number;
  candidateRate: number | null;
  baselineRate: number | null;
  fisherExactP: number | null;
  holmAdjustedP: number | null;
  significant: boolean | null;
}

export interface CombinedStatistic {
  candidateAllRate: number | null;
  baselineAllRate: number | null;
  fisherExactP: number | null;
  /** (candidateAllRate - baselineAllRate) * 100, or null if either is null. */
  deltaPp: number | null;
}

/**
 * Local mirror of the API contract's `SubmissionStatistics`
 * (`.agents/results/api-contracts/pdf-injection-phase3-5-api.md` §3). Field
 * names match exactly so apps/api can switch to `import type { ... } from
 * "@pdf-injection/contracts"` once that package exports it, without
 * changing callers of `compareRates()`.
 */
export interface SubmissionStatistics {
  candidateCount: number;
  baselineCount: number;
  perSignal: PerSignalStatistic[];
  combined: CombinedStatistic;
  familyWiseAlpha: 0.05;
  notes: string[];
}

/**
 * PRD §26 Phase 4 / API contract §3: compares per-signal and combined
 * "all-signals-matched" rates between a set of candidate submissions and a
 * set of known-original baseline submissions, with Fisher's exact test per
 * comparison and Holm-Bonferroni correction across the per-signal family.
 *
 * This produces statistical evidence for a human reviewer, never a verdict
 * — a statistically significant delta does not by itself establish that
 * any individual candidate used AI assistance (see `scoreSubmission()` and
 * `match-signals.ts` JSDoc for the same caveat).
 */
export function compareRates(
  signals: ExpectedSignal[],
  candidateTexts: string[],
  baselineTexts: string[],
): SubmissionStatistics {
  const candidateCount = candidateTexts.length;
  const baselineCount = baselineTexts.length;
  const familyWiseAlpha = 0.05 as const;
  const notes: string[] = [];

  if (candidateCount === 0)
    notes.push("No candidate submissions; candidate rates and hypothesis tests are null.");
  if (baselineCount === 0)
    notes.push("No baseline submissions; baseline rates and hypothesis tests are null.");
  if (signals.length === 0)
    notes.push("No expected signals configured; per-signal statistics are empty.");

  const candidateReports = candidateTexts.map((t) => matchSignals(signals, t));
  const baselineReports = baselineTexts.map((t) => matchSignals(signals, t));

  const perSignalRaw = signals.map((_, index) => {
    const candidateMatched = candidateReports.filter(
      (r) => r.results[index]?.matched === true,
    ).length;
    const baselineMatched = baselineReports.filter(
      (r) => r.results[index]?.matched === true,
    ).length;

    const candidateRate = candidateCount > 0 ? candidateMatched / candidateCount : null;
    const baselineRate = baselineCount > 0 ? baselineMatched / baselineCount : null;

    let fisherExactP: number | null = null;
    if (candidateCount > 0 && baselineCount > 0) {
      fisherExactP = fisherExact2x2(
        candidateMatched,
        candidateCount - candidateMatched,
        baselineMatched,
        baselineCount - baselineMatched,
      );
    } else {
      notes.push(
        `Signal index ${index}: insufficient sample for a hypothesis test (need at least one candidate and one baseline).`,
      );
    }

    return { index, candidateRate, baselineRate, fisherExactP };
  });

  const holmInputIndices: number[] = [];
  const holmInputPValues: number[] = [];
  perSignalRaw.forEach((s, i) => {
    if (s.fisherExactP !== null) {
      holmInputIndices.push(i);
      holmInputPValues.push(s.fisherExactP);
    }
  });
  const holmResults = holmBonferroni(holmInputPValues, familyWiseAlpha);

  const perSignal: PerSignalStatistic[] = perSignalRaw.map((s, i) => {
    const holmPos = holmInputIndices.indexOf(i);
    if (holmPos === -1) {
      return { ...s, holmAdjustedP: null, significant: null };
    }
    const holmEntry = holmResults[holmPos]!;
    return { ...s, holmAdjustedP: holmEntry.adjustedP, significant: holmEntry.significant };
  });

  const hasSignals = signals.length > 0;
  const candidateAllMatchedCount = candidateReports.filter(
    (r) => r.total > 0 && r.matchedCount === r.total,
  ).length;
  const baselineAllMatchedCount = baselineReports.filter(
    (r) => r.total > 0 && r.matchedCount === r.total,
  ).length;

  const candidateAllRate =
    hasSignals && candidateCount > 0 ? candidateAllMatchedCount / candidateCount : null;
  const baselineAllRate =
    hasSignals && baselineCount > 0 ? baselineAllMatchedCount / baselineCount : null;

  let combinedFisherExactP: number | null = null;
  if (hasSignals && candidateCount > 0 && baselineCount > 0) {
    combinedFisherExactP = fisherExact2x2(
      candidateAllMatchedCount,
      candidateCount - candidateAllMatchedCount,
      baselineAllMatchedCount,
      baselineCount - baselineAllMatchedCount,
    );
  }

  const deltaPp =
    candidateAllRate !== null && baselineAllRate !== null
      ? (candidateAllRate - baselineAllRate) * 100
      : null;

  return {
    candidateCount,
    baselineCount,
    perSignal,
    combined: { candidateAllRate, baselineAllRate, fisherExactP: combinedFisherExactP, deltaPp },
    familyWiseAlpha,
    notes,
  };
}
