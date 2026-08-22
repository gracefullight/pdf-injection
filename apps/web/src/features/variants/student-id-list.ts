export interface StudentIdParseResult {
  /** Unique, non-blank, trimmed ids in first-seen order. */
  ids: string[];
  /** Trimmed values that appeared more than once (each listed once). */
  duplicates: string[];
  blankLines: number;
}

/**
 * Parses a "one student id per line" textarea into a deduplicated id list.
 * Pure and side-effect free so it's independently unit-testable — see
 * student-id-list.test.ts.
 */
export function parseStudentIdList(raw: string): StudentIdParseResult {
  const lines = raw.split(/\r?\n/).map((line) => line.trim());
  const blankLines = lines.filter((line) => line.length === 0).length;

  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  const ids: string[] = [];

  for (const line of lines) {
    if (line.length === 0) continue;
    if (seen.has(line)) {
      duplicateSet.add(line);
      continue;
    }
    seen.add(line);
    ids.push(line);
  }

  return { ids, duplicates: [...duplicateSet], blankLines };
}
