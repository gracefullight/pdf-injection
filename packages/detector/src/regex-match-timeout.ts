import type { ExpectedSignal } from "@pdf-injection/contracts";
import { matchOneSignal, type SignalMatchEntry, type SignalMatchReport } from "./match-signals";
import { type RegexMatchResult, regexMatch } from "./regex-match";

/**
 * Hard cap on the number of `regex`-type `ExpectedSignal` entries evaluated
 * per `matchSignalsAsync()` call. Beyond this, extra regex signals are
 * reported as an error evidence object (never thrown, never evaluated) —
 * see the `matchSignals()` JSDoc in `match-signals.ts` for why an unbounded
 * count of regex signals is itself a DoS surface for an HTTP-facing caller.
 */
export const MAX_REGEX_SIGNALS_PER_CALL = 20;

/**
 * Hard cap on haystack (`text`) length, in UTF-16 code units, accepted by
 * `regexMatchWithTimeout()` / `matchSignalsAsync()` for `regex`-type
 * signals. Beyond this, the signal is reported as an error evidence object
 * instead of being evaluated (a very large haystack can itself make even a
 * "safe" pattern slow, independent of the pattern's own shape).
 */
export const MAX_HAYSTACK_LENGTH = 1_000_000;

/** Default wall-clock timeout for a single `regexMatchWithTimeout()` call. */
export const DEFAULT_REGEX_TIMEOUT_MS = 200;

export interface RegexMatchWithTimeoutOptions {
  /** default: `DEFAULT_REGEX_TIMEOUT_MS` (200ms) */
  timeoutMs?: number;
}

function buildWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  try {
    // NOTE: the URL specifier here is a string literal on purpose — Vite
    // (and other bundlers) statically detect `new Worker(new URL("...",
    // import.meta.url))` written inline like this to bundle regex-worker.ts
    // as a separate module-worker chunk. Do not extract this into a
    // variable or a wrapped helper that hides the literal from the parser.
    return new Worker(new URL("./regex-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

/**
 * Evaluates a regex `ExpectedSignal` pattern against `text` with a
 * wall-clock timeout, running the match on a dedicated `Worker` thread so a
 * pathological pattern's catastrophic backtracking can be forcibly
 * terminated (a same-thread `setTimeout` cannot interrupt synchronous JS —
 * see `regex-match.ts`'s documented residual ReDoS gap, e.g. alternation
 * shapes like `(a|aa)+` that the nested-quantifier heuristic misses).
 *
 * Falls back to the synchronous `regexMatch()` (no timeout protection) when
 * the `Worker` global is unavailable (older runtimes / some test
 * environments) or when constructing the worker throws.
 *
 * Never throws: on timeout, worker error, or any other failure this
 * resolves to `{ matched: false, positions: [], error: "Pattern timed out" }`
 * (or a more specific error message) rather than rejecting.
 *
 * This is a deterministic string matcher, not an "AI detected" verdict —
 * see `match-signals.ts`'s JSDoc.
 */
export function regexMatchWithTimeout(
  pattern: string,
  flags: string,
  text: string,
  options: RegexMatchWithTimeoutOptions = {},
): Promise<RegexMatchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REGEX_TIMEOUT_MS;

  if (text.length > MAX_HAYSTACK_LENGTH) {
    return Promise.resolve({
      matched: false,
      positions: [],
      error: `Haystack exceeds the maximum length of ${MAX_HAYSTACK_LENGTH} characters.`,
    });
  }

  const worker = buildWorker();
  if (!worker) {
    // No Worker available in this environment: fall back to sync (no
    // timeout protection — see JSDoc above).
    return Promise.resolve(regexMatch(pattern, flags, text));
  }

  return new Promise<RegexMatchResult>((resolve) => {
    let settled = false;

    const finish = (result: RegexMatchResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ matched: false, positions: [], error: "Pattern timed out" });
    }, timeoutMs);

    worker.onmessage = (event: MessageEvent<RegexMatchResult>) => {
      finish(event.data);
    };

    worker.onerror = () => {
      finish({ matched: false, positions: [], error: "Worker error while evaluating pattern." });
    };

    worker.postMessage({ pattern, flags, text });
  });
}

export interface MatchSignalsAsyncOptions extends RegexMatchWithTimeoutOptions {}

/**
 * Async counterpart to `matchSignals()` (match-signals.ts): non-`regex`
 * signals are evaluated synchronously and immediately (unchanged
 * semantics); `regex` signals are evaluated via `regexMatchWithTimeout()`
 * on a Worker thread, subject to `MAX_REGEX_SIGNALS_PER_CALL` and
 * `MAX_HAYSTACK_LENGTH`.
 *
 * When either cap is exceeded, the affected regex signal(s) are reported
 * as `{ matched: false, evidence: { error } }` — this function never
 * throws.
 *
 * Intended for HTTP-facing callers (e.g. apps/api's Model Test / Submission
 * phases) that need a bounded worst case per request; pure in-process
 * callers that fully trust their signal set can keep using the synchronous
 * `matchSignals()`.
 *
 * IMPORTANT (same as `matchSignals()`): this is a deterministic
 * string/structure matcher only — no "AI detected" / "cheating detected"
 * verdict field, and none should ever be added.
 */
export async function matchSignalsAsync(
  signals: ExpectedSignal[],
  text: string,
  options: MatchSignalsAsyncOptions = {},
): Promise<SignalMatchReport> {
  const haystackTooLong = text.length > MAX_HAYSTACK_LENGTH;
  const haystackError = `Haystack exceeds the maximum length of ${MAX_HAYSTACK_LENGTH} characters.`;

  let regexSeen = 0;
  const results: SignalMatchEntry[] = [];

  for (const signal of signals) {
    if (signal.type !== "regex") {
      results.push(matchOneSignal(signal, text));
      continue;
    }

    regexSeen++;

    if (haystackTooLong) {
      results.push({ signal, matched: false, evidence: { positions: [], error: haystackError } });
      continue;
    }

    if (regexSeen > MAX_REGEX_SIGNALS_PER_CALL) {
      results.push({
        signal,
        matched: false,
        evidence: {
          positions: [],
          error: `Too many regex signals in a single call (max ${MAX_REGEX_SIGNALS_PER_CALL}).`,
        },
      });
      continue;
    }

    // Sequential await-in-loop is intentional: bounded by MAX_REGEX_SIGNALS_PER_CALL, each on its own worker/timeout.
    const result = await regexMatchWithTimeout(signal.pattern, signal.flags, text, {
      timeoutMs: options.timeoutMs,
    });
    results.push({
      signal,
      matched: result.matched,
      evidence: { positions: result.positions, error: result.error },
    });
  }

  const matchedCount = results.filter((r) => r.matched).length;
  return { results, matchedCount, total: signals.length };
}
