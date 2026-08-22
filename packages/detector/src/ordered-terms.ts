export interface OrderedTermsOptions {
  /** default: false (case-insensitive) */
  caseSensitive?: boolean;
}

export interface OrderedTermsResult {
  /** true only when every term was found, strictly in the given order. */
  matched: boolean;
  /** Per-term match position (null if that term was not found after the previous one). */
  positions: Array<number | null>;
}

/**
 * Checks that every term in `terms` appears in `text`, strictly in order.
 * Algorithm: first-occurrence-after-previous — each term is searched for
 * starting right after the end of the previous term's match, so overlapping
 * or repeated substrings are handled deterministically.
 */
export function orderedTermsMatch(
  terms: string[],
  text: string,
  options: OrderedTermsOptions = {},
): OrderedTermsResult {
  if (terms.length === 0) {
    return { matched: false, positions: [] };
  }

  const caseSensitive = options.caseSensitive ?? false;
  const haystack = caseSensitive ? text : text.toLowerCase();

  const positions: Array<number | null> = [];
  let searchFrom = 0;
  let allFound = true;

  for (const term of terms) {
    const needle = caseSensitive ? term : term.toLowerCase();
    if (needle.length === 0) {
      positions.push(null);
      allFound = false;
      continue;
    }
    const idx = haystack.indexOf(needle, searchFrom);
    if (idx === -1) {
      positions.push(null);
      allFound = false;
    } else {
      positions.push(idx);
      searchFrom = idx + needle.length;
    }
  }

  return { matched: allFound, positions };
}
