/**
 * Heuristic fallback for `ModelTestResult.refusal` per contract §2 ("provider
 * stop_reason === 'refusal' OR refusal heuristics"). Used when a provider
 * does not surface a structured refusal signal (e.g. the `mock` adapter, or
 * a real provider that declines in prose without a dedicated stop reason).
 *
 * Deliberately conservative (favors false negatives over false positives):
 * only matches common, explicit refusal openers, anchored near the start of
 * the response so an assignment answer that merely discusses the concept of
 * declining (e.g. "students might refuse an unethical request") is not
 * misclassified.
 */
const REFUSAL_PATTERNS: RegExp[] = [
  /^\s*(i'?m sorry,?\s*)?(but\s+)?i (?:can'?t|cannot|can not|won'?t|will not|am (?:not able|unable)) (?:help|assist|comply|do that|complete|continue|provide)/i,
  /^\s*i must decline/i,
  /^\s*as an ai(?:,| )/i,
  /^\s*i'?m not able to (?:help|assist|comply)/i,
  /^\s*sorry,?\s*(?:but\s+)?i (?:can'?t|cannot|can not)/i,
];

/** Only the first N characters are checked (refusals are almost always the opening of the response). */
const REFUSAL_SCAN_WINDOW = 400;

export function detectRefusalHeuristic(text: string): boolean {
  if (!text) return false;
  const head = text.slice(0, REFUSAL_SCAN_WINDOW);
  return REFUSAL_PATTERNS.some((re) => re.test(head));
}
