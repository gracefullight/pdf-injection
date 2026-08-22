import type { ExpectedSignal } from "@pdf-injection/contracts";
import { exactMatch } from "./exact-match";
import { methodologyMatch } from "./methodology-match";
import { orderedTermsMatch } from "./ordered-terms";
import { regexMatch } from "./regex-match";
import { sectionOrderMatch } from "./section-order";

export interface SignalMatchEntry {
  signal: ExpectedSignal;
  matched: boolean;
  /** Matcher-specific evidence (positions, headings, matchedTerm, error, ...). Never a verdict field. */
  evidence: Record<string, unknown>;
}

export interface SignalMatchReport {
  results: SignalMatchEntry[];
  matchedCount: number;
  total: number;
}

/**
 * Applies the deterministic evidence matchers in this package to a single
 * ExpectedSignal, per PRD §21.5 / §12.
 */
/**
 * Applies a single deterministic matcher, dispatched by `signal.type`.
 * Exported (in addition to `matchSignals`) so `regex-match-timeout.ts` can
 * reuse the non-regex branches without duplicating this switch.
 */
export function matchOneSignal(signal: ExpectedSignal, text: string): SignalMatchEntry {
  switch (signal.type) {
    case "exact_phrase": {
      const direct = exactMatch(signal.value, text, { caseSensitive: signal.caseSensitive });
      if (direct.matched) {
        return {
          signal,
          matched: true,
          evidence: { positions: direct.positions, whitespaceNormalized: false },
        };
      }
      const normalized = exactMatch(signal.value, text, {
        caseSensitive: signal.caseSensitive,
        normalizeWhitespace: true,
      });
      return {
        signal,
        matched: normalized.matched,
        evidence: { positions: normalized.positions, whitespaceNormalized: normalized.matched },
      };
    }
    case "regex": {
      const result = regexMatch(signal.pattern, signal.flags, text);
      return {
        signal,
        matched: result.matched,
        evidence: { positions: result.positions, error: result.error },
      };
    }
    case "methodology_label": {
      const result = methodologyMatch(signal.value, signal.aliases, text);
      return {
        signal,
        matched: result.matched,
        evidence: { positions: result.positions, matchedTerm: result.matchedTerm },
      };
    }
    case "ordered_terms": {
      const result = orderedTermsMatch(signal.values, text);
      return { signal, matched: result.matched, evidence: { positions: result.positions } };
    }
    case "section_order": {
      const result = sectionOrderMatch(signal.values, text);
      return {
        signal,
        matched: result.matched,
        evidence: { positions: result.positions, headings: result.headings },
      };
    }
  }
}

/**
 * Runs every ExpectedSignal against `text` and returns per-signal match
 * evidence.
 *
 * IMPORTANT (PRD §21.5, §12.1): this function is a deterministic
 * string/structure matcher only. It intentionally has NO "AI detected",
 * "cheating detected", or similar verdict field, and none should ever be
 * added. A match is evidence a human reviewer can inspect — not proof of
 * anything on its own, and the absence of a match is not proof either.
 *
 * PERFORMANCE / DoS NOTE for future HTTP-facing callers (e.g. apps/api's
 * Model Test phase, per PRD §21): `regex`-type signals are guarded by a
 * pattern length cap and a nested-quantifier ReDoS heuristic (see
 * `regex-match.ts`), but that heuristic cannot catch every catastrophic
 * pattern (e.g. alternation-based blowup like `(a|aa)+`). A single
 * `signals` array is not bounded in length by this function. Callers that
 * expose `matchSignals()` over HTTP should: (1) cap the number of `regex`
 * signals evaluated per call (a small constant, e.g. <= 20, is a reasonable
 * default), and (2) run the call with a wall-clock timeout / off the
 * request thread, since a worst-case pattern this heuristic misses could
 * still stall the caller.
 */
export function matchSignals(signals: ExpectedSignal[], text: string): SignalMatchReport {
  const results = signals.map((signal) => matchOneSignal(signal, text));
  const matchedCount = results.filter((r) => r.matched).length;
  return { results, matchedCount, total: signals.length };
}
