/**
 * Internal numerically-stable log-factorial / log-binomial-coefficient
 * helpers shared by `statistics.ts` (Fisher's exact test) and
 * `calibration.ts` (exact binomial test). Not part of the public API —
 * intentionally not re-exported from `index.ts`.
 */

const logFactorialCache: number[] = [0, 0]; // log(0!) = 0, log(1!) = 0

/** log(n!) via an incrementally-memoized running sum (exact for the double
 * precision range used by these small-sample statistical tests). */
export function logFactorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) {
    throw new RangeError("logFactorial: n must be a non-negative integer");
  }
  if (n < logFactorialCache.length) return logFactorialCache[n]!;
  for (let i = logFactorialCache.length; i <= n; i++) {
    logFactorialCache.push(logFactorialCache[i - 1]! + Math.log(i));
  }
  return logFactorialCache[n]!;
}

/** log(C(n, k)), or -Infinity for an out-of-range k (so exp() of it is 0). */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}
