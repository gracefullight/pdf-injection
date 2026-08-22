export interface ExactMatchOptions {
  /** default: true */
  caseSensitive?: boolean;
  /**
   * When true, runs of whitespace (including Unicode spaces and NBSP —
   * `\s` already covers these in JS) are collapsed to a single space in
   * both the needle and the haystack before searching. Reported positions
   * are still mapped back to offsets in the original (un-normalized) text.
   */
  normalizeWhitespace?: boolean;
}

export interface ExactMatchResult {
  matched: boolean;
  positions: number[];
}

const WHITESPACE_RE = /\s/;

/**
 * Collapses runs of whitespace to a single space (leading/trailing
 * whitespace is dropped) and returns a mapping from each character in the
 * normalized string back to its index in the original string.
 */
function buildNormalizedMapping(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i]!;
    if (WHITESPACE_RE.test(ch)) {
      const runStart = i;
      while (i < n && WHITESPACE_RE.test(text[i]!)) i++;
      // Only emit a collapsed space if it is not leading/trailing whitespace.
      if (normalized.length > 0 && i < n) {
        normalized += " ";
        map.push(runStart);
      }
    } else {
      normalized += ch;
      map.push(i);
      i++;
    }
  }

  return { normalized, map };
}

function findAllPositions(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + needle.length;
  }
  return positions;
}

/**
 * Finds all occurrences of `value` inside `text`.
 * PRD §21.5 / §12: pure evidence match — no verdict.
 */
export function exactMatch(
  value: string,
  text: string,
  options: ExactMatchOptions = {},
): ExactMatchResult {
  const caseSensitive = options.caseSensitive ?? true;

  if (value.length === 0 || text.length === 0) {
    return { matched: false, positions: [] };
  }

  if (!options.normalizeWhitespace) {
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? value : value.toLowerCase();
    const positions = findAllPositions(haystack, needle);
    return { matched: positions.length > 0, positions };
  }

  const { normalized: normalizedText, map } = buildNormalizedMapping(text);
  const { normalized: normalizedValue } = buildNormalizedMapping(value);

  const haystack = caseSensitive ? normalizedText : normalizedText.toLowerCase();
  const needle = caseSensitive ? normalizedValue : normalizedValue.toLowerCase();
  const normalizedPositions = findAllPositions(haystack, needle);
  const positions = normalizedPositions.map((idx) => map[idx]!);

  return { matched: positions.length > 0, positions };
}
