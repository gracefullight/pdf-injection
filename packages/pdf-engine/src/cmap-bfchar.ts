export interface BfCharEntry {
  glyphHex: string;
  targetHex: string;
}

// Scopes parsing to the `beginbfchar ... endbfchar` block body only — the
// CMap text also contains an unrelated `<0000><ffff>` codespacerange pair
// (see pdf-lib's CMap.js fillCmapTemplate) that must not be mistaken for a
// glyph->unicode entry.
const BFCHAR_BLOCK_RE = /beginbfchar([\s\S]*?)endbfchar/;
// beginbfchar entries pdf-lib's own CMap builder writes for a Type0/CID font:
// `<glyphIdHex4> <targetHex...>` (glyphId and target are SPACE-separated —
// see fillCmapTemplate's `glyphId + " " + codePoint`; target is one or more
// concatenated 4-hex groups — for plain ASCII payloads pdf-lib writes
// exactly one group per entry, since ASCII codepoints are within the BMP).
const BFCHAR_ENTRY_RE = /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>/g;

/**
 * Parses the `beginbfchar...endbfchar` entries out of a ToUnicode CMap text
 * stream, in the exact structural shape pdf-lib's own `CMap.js`
 * (`fillCmapTemplate`) writes them. Shared by `inject-unicode-tags.ts`
 * (which rebuilds these entries with Unicode-Tag-block targets) and
 * `read-unicode-tags-payload.ts` (which decodes them back) — both operate on
 * the SAME CMap text shape, so a single parser keeps them from drifting.
 * Returns `[]` when `cmapText` has no `beginbfchar` block.
 */
export function parseBfCharEntries(cmapText: string): BfCharEntry[] {
  const blockMatch = BFCHAR_BLOCK_RE.exec(cmapText);
  if (!blockMatch) return [];
  const block = blockMatch[1] as string;

  const entries: BfCharEntry[] = [];
  BFCHAR_ENTRY_RE.lastIndex = 0;
  let match = BFCHAR_ENTRY_RE.exec(block);
  while (match !== null) {
    entries.push({ glyphHex: match[1] as string, targetHex: match[2] as string });
    match = BFCHAR_ENTRY_RE.exec(block);
  }
  return entries;
}

/**
 * Decodes a bfchar `targetHex` string into the sequence of characters it
 * represents. A target is one or more concatenated 4-hex-digit groups, each
 * group a single UTF-16 code unit (see pdf-lib's `CMap.js`
 * `cmapCodePointFormat`: BMP codepoints get exactly one group, astral
 * codepoints get two groups forming a surrogate pair). Most glyphs map to a
 * single character (one group), but a **ligature glyph** (e.g. "ff", "fi",
 * "ffl" — produced by fontkit/HarfBuzz GSUB substitution when drawing a
 * shaped text run) maps to MULTIPLE groups, one per original character the
 * ligature glyph replaced. Splitting into 4-hex groups and reassembling via
 * `String.fromCharCode` (not `Number.parseInt`-ing the whole string as one
 * value) is required to preserve that multiplicity — treating a multi-group
 * target as a single numeric codepoint silently corrupts/drops the extra
 * characters. `Array.from` on the resulting string iterates by Unicode code
 * point, so any astral-codepoint group pair is correctly reassembled into
 * one returned character rather than two unpaired surrogate halves.
 */
export function decodeCMapTargetChars(targetHex: string): string[] {
  const units: number[] = [];
  for (let i = 0; i < targetHex.length; i += 4) {
    units.push(Number.parseInt(targetHex.slice(i, i + 4), 16));
  }
  return Array.from(String.fromCharCode(...units));
}
