export interface MethodologyMatchResult {
  matched: boolean;
  /** The value or alias string that produced the match, or null. */
  matchedTerm: string | null;
  positions: number[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a case-insensitive, word-boundary-anchored regex for a term.
 * Internal whitespace in the term tolerates any run of whitespace in the
 * text (e.g. "Method C" matches "Method\nC" or "Method   C"). `\b`
 * boundaries mean "Method C" will NOT match inside "Method Cat".
 */
function buildTermRegex(term: string): RegExp | null {
  const trimmed = term.trim();
  if (trimmed.length === 0) return null;
  const escaped = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

function findPositions(term: string, text: string): number[] {
  const regex = buildTermRegex(term);
  if (!regex || text.length === 0) return [];
  const positions: number[] = [];
  for (const m of text.matchAll(regex)) {
    positions.push(m.index);
  }
  return positions;
}

/**
 * Checks whether `value` or one of `aliases` appears in `text`, honouring
 * word boundaries so "Method C" does not falsely match "Method Cat".
 * Candidates are tried in order [value, ...aliases]; the first candidate
 * with any occurrence wins.
 */
export function methodologyMatch(
  value: string,
  aliases: string[],
  text: string,
): MethodologyMatchResult {
  const candidates = [value, ...aliases];
  for (const candidate of candidates) {
    const positions = findPositions(candidate, text);
    if (positions.length > 0) {
      return { matched: true, matchedTerm: candidate, positions };
    }
  }
  return { matched: false, matchedTerm: null, positions: [] };
}
