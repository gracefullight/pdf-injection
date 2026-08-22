export interface DetectedHeading {
  text: string;
  lineIndex: number;
  /** Character offset of the start of this heading's line in the original text. */
  charOffset: number;
}

export interface SectionOrderResult {
  /** true only when every required section name was found, strictly in heading order. */
  matched: boolean;
  headings: DetectedHeading[];
  /** Per-section-name match position (character offset), null if not found after the previous one. */
  positions: Array<number | null>;
}

const MD_HEADING_RE = /^#{1,6}\s+(.+)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.+)$/;
const COLON_END_RE = /^(.{1,120}):\s*$/;
const MAX_ALL_CAPS_LINE_LENGTH = 80;

function isAllCapsShortLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ALL_CAPS_LINE_LENGTH) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase();
}

/**
 * Extracts heading text from a single line, or returns null if the line
 * does not look like a heading. Checked in priority order: markdown `#`,
 * numbered (`1.` / `1)`), ALL-CAPS short line, line ending with `:`.
 */
function extractHeadingText(line: string): string | null {
  let m = MD_HEADING_RE.exec(line);
  if (m) return m[1]!.trim();

  m = NUMBERED_RE.exec(line);
  if (m) return m[1]!.trim();

  const trimmed = line.trim();
  if (isAllCapsShortLine(trimmed)) return trimmed;

  m = COLON_END_RE.exec(line);
  if (m) return m[1]!.trim();

  return null;
}

/** Splits `text` into lines (handling \n, \r\n, \r) while tracking each line's start offset. */
function detectHeadings(text: string): DetectedHeading[] {
  const headings: DetectedHeading[] = [];
  const n = text.length;
  let lineStart = 0;
  let lineIndex = 0;

  for (let i = 0; i <= n; i++) {
    if (i === n || text[i] === "\n") {
      let lineEnd = i;
      if (lineEnd > lineStart && text[lineEnd - 1] === "\r") lineEnd--;
      const line = text.slice(lineStart, lineEnd);
      const headingText = extractHeadingText(line);
      if (headingText) {
        headings.push({ text: headingText, lineIndex, charOffset: lineStart });
      }
      lineStart = i + 1;
      lineIndex++;
    }
  }

  return headings;
}

/**
 * Checks that `sectionNames` appear, in order, among the headings detected
 * in `text`. A section name matches a heading via case-insensitive
 * substring containment.
 */
export function sectionOrderMatch(sectionNames: string[], text: string): SectionOrderResult {
  const headings = detectHeadings(text);

  if (sectionNames.length === 0) {
    return { matched: false, headings, positions: [] };
  }

  const positions: Array<number | null> = [];
  let cursor = 0;
  let allFound = true;

  for (const name of sectionNames) {
    const needle = name.trim().toLowerCase();
    let found = -1;
    for (let i = cursor; i < headings.length; i++) {
      if (headings[i]!.text.toLowerCase().includes(needle)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      positions.push(null);
      allFound = false;
    } else {
      positions.push(headings[found]!.charOffset);
      cursor = found + 1;
    }
  }

  return { matched: allFound, headings, positions };
}
