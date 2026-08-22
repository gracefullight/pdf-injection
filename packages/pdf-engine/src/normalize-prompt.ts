/**
 * Normalizes a hidden instruction prompt before hashing/injection.
 * PRD §8.5 step 2 / task-1 spec: CRLF -> LF, strip trailing whitespace per
 * line, trim overall, collapse 3+ consecutive blank lines down to 1. Must be
 * idempotent: normalizePrompt(normalizePrompt(x)) === normalizePrompt(x).
 */
export function normalizePrompt(input: string): string {
  const crlfToLf = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const strippedTrailing = crlfToLf
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  const collapsedBlankLines = strippedTrailing.replace(/\n{3,}/g, "\n\n");
  return collapsedBlankLines.trim();
}
