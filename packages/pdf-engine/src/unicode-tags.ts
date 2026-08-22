/**
 * Unicode Tag block (U+E0000-U+E007F) codec for the `unicode_tags` injection
 * mode. Round 2 addendum §7 / plan session 20260822-190520
 * architecture_decisions #4.
 *
 * Each printable-ASCII payload character c (0x20-0x7E) maps 1:1 to the tag
 * codepoint U+E0000 + codepoint(c) (e.g. 'a' 0x61 -> U+E0061). `encodeUnicodeTags`
 * frames the payload with a BEGIN marker (U+E0001) prefixed and a CANCEL
 * marker (U+E007F) suffixed so a decoder can unambiguously locate the run
 * even when embedded inside other extracted text — this framing is only
 * meaningful when the encoded string is embedded LITERALLY (e.g. spliced
 * directly into a plain-text string, as `packages/benchmark`'s
 * `disclosure.test.ts` does to simulate stray tag noise). It must NOT be
 * used to mark a glyph in a ToUnicode CMap (`beginbfchar` target): a CMap
 * entry is keyed by glyph and shared by every drawn occurrence of that
 * glyph, so a marker attached there is reproduced at every position the
 * glyph is drawn, not just the intended one — `inject-unicode-tags.ts`
 * (the only production caller that rewrites a ToUnicode CMap) deliberately
 * does NOT use `encodeUnicodeTags`/BEGIN/CANCEL for this reason; see its
 * module doc, "Why no BEGIN/CANCEL framing". `decodeUnicodeTags` tolerates
 * frame markers being absent or stripped (e.g. by a lossy copy/paste, a
 * provider's Unicode normalization, or a glyph-keyed-CMap-based source like
 * `readUnicodeTagsPayload`) by falling back to any maximal run of plain
 * payload-range tag characters (U+E0020-U+E007E) — for CMap-sourced text
 * this fallback is the ONLY applicable path, not a fallback of last resort.
 */

export const UNICODE_TAG_BASE = 0xe0000;
export const UNICODE_TAG_BEGIN = 0xe0001;
export const UNICODE_TAG_CANCEL = 0xe007f;

/** Printable ASCII (0x20-0x7E) — the only range representable by this tag-block mapping. */
const PRINTABLE_ASCII_RE = /^[\x20-\x7E]*$/;

// The tag-codepoint range that actual encoded payload characters occupy is
// BASE+0x20..BASE+0x7E (i.e. U+E0020-U+E007E) — hardcoded as literal \u{...}
// escapes in FRAMED_RUN_RE/UNFRAMED_RUN_RE below (regex character classes
// cannot interpolate computed values).

/**
 * Encodes `ascii` (printable ASCII only) as a BEGIN...CANCEL-framed run of
 * Unicode Tag characters. Throws a plain `Error` on non-ASCII input (the
 * caller, `inject.ts`, catches and re-throws as `PromptEncodingFailedError`).
 */
export function encodeUnicodeTags(ascii: string): string {
  if (!PRINTABLE_ASCII_RE.test(ascii)) {
    throw new Error(
      "encodeUnicodeTags: input must be printable ASCII (0x20-0x7E) only — " +
        "the Unicode Tag block has no defined mapping for non-ASCII codepoints.",
    );
  }

  let out = String.fromCodePoint(UNICODE_TAG_BEGIN);
  for (let i = 0; i < ascii.length; i++) {
    out += String.fromCodePoint(UNICODE_TAG_BASE + (ascii.codePointAt(i) as number));
  }
  out += String.fromCodePoint(UNICODE_TAG_CANCEL);
  return out;
}

// Matches a BEGIN marker, a maximal run of payload-range tag characters
// (deliberately excludes BEGIN/CANCEL themselves so runs don't overlap),
// then a CANCEL marker.
const FRAMED_RUN_RE = /\u{E0001}([\u{E0020}-\u{E007E}]*)\u{E007F}/gu;
// Fallback: any maximal run of payload-range tag characters, with no frame
// markers required (tolerant decode for stripped/lossy BEGIN/CANCEL).
const UNFRAMED_RUN_RE = /[\u{E0020}-\u{E007E}]+/gu;

function decodeTagRun(run: string): string {
  let out = "";
  for (const ch of run) {
    out += String.fromCodePoint((ch.codePointAt(0) as number) - UNICODE_TAG_BASE);
  }
  return out;
}

/**
 * Returns every BEGIN...CANCEL-framed run found in `text`, decoded back to
 * plain ASCII. If no framed run is found, falls back to any maximal run of
 * payload-range tag characters (tolerant of stripped frame markers). Returns
 * `[]` when neither is found.
 */
export function decodeUnicodeTags(text: string): string[] {
  const framed: string[] = [];
  FRAMED_RUN_RE.lastIndex = 0;
  let match = FRAMED_RUN_RE.exec(text);
  while (match !== null) {
    framed.push(decodeTagRun(match[1] as string));
    match = FRAMED_RUN_RE.exec(text);
  }
  if (framed.length > 0) return framed;

  const unframed: string[] = [];
  UNFRAMED_RUN_RE.lastIndex = 0;
  match = UNFRAMED_RUN_RE.exec(text);
  while (match !== null) {
    unframed.push(decodeTagRun(match[0]));
    match = UNFRAMED_RUN_RE.exec(text);
  }
  return unframed;
}

const ANY_TAG_CHAR_RE = /[\u{E0000}-\u{E007F}]/gu;

/** Removes every Unicode Tag block character (U+E0000-U+E007F) from `text`, leaving everything else untouched. */
export function stripUnicodeTags(text: string): string {
  return text.replace(ANY_TAG_CHAR_RE, "");
}
