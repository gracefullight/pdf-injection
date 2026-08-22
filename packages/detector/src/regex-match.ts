export interface RegexMatchResult {
  matched: boolean;
  positions: number[];
  error?: string;
}

/** Whitelisted regex flags. No `y` (sticky) or `d` (indices) etc. */
const ALLOWED_FLAGS = new Set(["g", "i", "m", "s", "u"]);

/** Maximum accepted `ExpectedSignal.regex.pattern` length, in characters. */
export const MAX_PATTERN_LENGTH = 500;

// A quantifier: +, *, ?, or a brace form ({n}, {n,}, {n,m}).
const QUANTIFIER = String.raw`(?:[+*?]|\{\d+,?\d*\})`;
// A (possibly non-capturing) group whose own content contains a quantifier char.
const GROUP_WITH_INNER_QUANTIFIER = String.raw`\((?:\?:)?[^()]*${QUANTIFIER}[^()]*\)`;
/**
 * Heuristic catastrophic-backtracking guard: rejects patterns where a group
 * (capturing or non-capturing) contains an inner quantifier (`+`, `*`, `?`,
 * or a brace form like `{2,}`) and is itself immediately followed by an
 * outer quantifier — the classic nested/stacked-quantifier ReDoS shape
 * (e.g. `(a+)+`, `(a*)*`, `(a+)*`, `(a?)*`, `(?:a+)+`, `(a{2,})+`).
 *
 * This is a defense-in-depth heuristic, not full static analysis of the
 * regex's NFA: it does NOT catch every catastrophic shape — most notably
 * alternation-based blowup such as `(a|aa)+`, or patterns whose dangerous
 * structure spans more than one level of `()` nesting (this heuristic only
 * looks one group deep, since `[^()]*` inside the group deliberately does
 * not match nested parentheses). The 500-char length guard and this
 * heuristic together bound the *common* worst case, but callers that need
 * a hard guarantee (e.g. a future HTTP-facing consumer like apps/api's
 * Model Test phase) should still evaluate `matchSignals()` off the request
 * thread with a wall-clock timeout, and should cap how many `regex`-type
 * `ExpectedSignal` entries are evaluated per call — see the `matchSignals`
 * JSDoc in match-signals.ts.
 */
const NESTED_QUANTIFIER_RE = new RegExp(`${GROUP_WITH_INNER_QUANTIFIER}${QUANTIFIER}`);

/**
 * Evaluates a user-supplied regex pattern against `text` and returns every
 * match position. Never throws: invalid patterns, disallowed flags,
 * over-length patterns, and patterns matching the nested-quantifier ReDoS
 * heuristic (see `NESTED_QUANTIFIER_RE`) are reported as
 * `{ matched: false, error }`.
 */
export function regexMatch(pattern: string, flags: string, text: string): RegexMatchResult {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return {
      matched: false,
      positions: [],
      error: `Pattern exceeds the maximum length of ${MAX_PATTERN_LENGTH} characters.`,
    };
  }

  if (NESTED_QUANTIFIER_RE.test(pattern)) {
    return {
      matched: false,
      positions: [],
      error: "Pattern rejected: nested quantifiers can cause catastrophic backtracking.",
    };
  }

  for (const flag of flags) {
    if (!ALLOWED_FLAGS.has(flag)) {
      return { matched: false, positions: [], error: `Disallowed regex flag: "${flag}".` };
    }
  }

  // Always scan with the global flag internally to collect all positions,
  // regardless of whether the caller supplied "g".
  const scanFlags = flags.includes("g") ? flags : `${flags}g`;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, scanFlags);
  } catch (e) {
    return {
      matched: false,
      positions: [],
      error: e instanceof Error ? e.message : "Invalid regular expression.",
    };
  }

  const positions: number[] = [];
  try {
    for (const m of text.matchAll(regex)) {
      positions.push(m.index);
    }
  } catch (e) {
    return {
      matched: false,
      positions: [],
      error: e instanceof Error ? e.message : "Regex evaluation failed.",
    };
  }

  return { matched: positions.length > 0, positions };
}
