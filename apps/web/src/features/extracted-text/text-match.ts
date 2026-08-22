export interface TextMatchResult {
  exactMatch: boolean;
  normalizedMatch: boolean;
  caseInsensitiveMatch: boolean;
  matchOffset: number | null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Compares a page's PDF.js-extracted text against the (normalized) hidden
 * instruction, mirroring the server's `serverValidation.textExtraction.pages[]`
 * shape (exact / whitespace-normalized / case-insensitive match + offset).
 */
export function computeTextMatch(pageText: string, normalizedInstruction: string): TextMatchResult {
  if (normalizedInstruction.length === 0) {
    return {
      exactMatch: false,
      normalizedMatch: false,
      caseInsensitiveMatch: false,
      matchOffset: null,
    };
  }

  const exactIndex = pageText.indexOf(normalizedInstruction);
  const exactMatch = exactIndex !== -1;

  const normalizedPage = normalizeWhitespace(pageText);
  const normalizedNeedle = normalizeWhitespace(normalizedInstruction);
  const normalizedIndex = normalizedPage.indexOf(normalizedNeedle);
  const normalizedMatch = normalizedIndex !== -1;

  const caseInsensitiveIndex = normalizedPage.toLowerCase().indexOf(normalizedNeedle.toLowerCase());
  const caseInsensitiveMatch = caseInsensitiveIndex !== -1;

  const matchOffset = exactMatch
    ? exactIndex
    : normalizedMatch
      ? normalizedIndex
      : caseInsensitiveMatch
        ? caseInsensitiveIndex
        : null;

  return { exactMatch, normalizedMatch, caseInsensitiveMatch, matchOffset };
}
