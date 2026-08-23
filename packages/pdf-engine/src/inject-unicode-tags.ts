import type { Position } from "@pdf-injection/contracts";
import {
  beginText,
  decodePDFRawStream,
  endText,
  PDFDict,
  PDFDocument,
  type PDFFont,
  PDFName,
  PDFRawStream,
  PDFStream,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
} from "pdf-lib";
import { type BfCharEntry, decodeCMapTargetChars, parseBfCharEntries } from "./cmap-bfchar";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";
import { UNICODE_TAG_BASE } from "./unicode-tags";

/**
 * Embeds the font this mode draws with. Injected rather than imported so the
 * injector stays runtime-agnostic: the server loads the bundled subset from
 * disk (`korean-font.ts`), the browser fetches it (`browser-cjk-font.ts`).
 * Any CID-keyed, ASCII-complete font works — the glyphs are never visible
 * (render mode 3); only its `/ToUnicode` CMap matters.
 */
export type UnicodeTagsFontEmbedder = (doc: PDFDocument, text: string) => Promise<PDFFont>;

export interface InjectUnicodeTagsInput {
  doc: PDFDocument;
  /** Defaults to the Node bundled-font embedder via `inject-unicode-tags-node.ts`. */
  embedFont: UnicodeTagsFontEmbedder;
  pageIndex: number;
  instruction: string;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
}

export interface InjectUnicodeTagsResult extends InjectTextResult {
  /**
   * The reloaded, ToUnicode-rewritten `PDFDocument` instance. `inject.ts`'s
   * dispatcher must swap its local `doc` variable to this BEFORE its own
   * final `doc.save()` / reload / geometry-check step.
   */
  doc: PDFDocument;
}

function toHex4(n: number): string {
  return n.toString(16).padStart(4, "0").toUpperCase();
}

/**
 * UTF-16 surrogate-pair-encodes a codepoint above the BMP (U+10000-U+10FFFF)
 * as two concatenated 4-hex-digit groups — the same mechanism pdf-lib's own
 * `CMap.js` (`cmapCodePointFormat`) uses for astral-codepoint glyph->unicode
 * targets (e.g. ligature glyphs mapping to multiple codepoints). Required
 * here because every Unicode Tag block codepoint (U+E0000-U+E007F) is above
 * the BMP and a single 4-hex-digit group cannot represent it.
 */
function surrogatePairHex(codepoint: number): string {
  const hs = Math.floor((codepoint - 0x10000) / 0x400) + 0xd800;
  const ls = ((codepoint - 0x10000) % 0x400) + 0xdc00;
  return `${toHex4(hs)}${toHex4(ls)}`;
}

/**
 * Rebuilds each bfchar entry's target as a sequence of Unicode-Tag-block
 * codepoints (U+E0000 + each original character's codepoint), each
 * UTF-16-surrogate-pair encoded. Most entries' original target decodes to a
 * single character, but a **ligature glyph** (fontkit/HarfBuzz GSUB
 * substitution applied to the shaped payload run — e.g. "ff", "fi", "fl",
 * "ffi", "ffl" each become one glyph) has a target that decodes to MULTIPLE
 * characters (see `decodeCMapTargetChars`'s doc). Every one of those
 * characters is mapped to its own tag codepoint and the results are
 * concatenated into the SAME entry's target, preserving full multiplicity —
 * this mirrors exactly how pdf-lib's own CMap builder encodes a
 * multi-codepoint ligature target in the first place.
 *
 * **No BEGIN/CANCEL framing marker is attached to any entry** (removed —
 * see "Why no BEGIN/CANCEL framing" in this file's module doc). Deliberately
 * NOT reusing `i === 0` / `i === entries.length - 1` (CMap-write / glyph
 * first-appearance order) as a stand-in for "first/last drawn character": a
 * ToUnicode CMap entry is keyed by GLYPH, shared by every drawn occurrence
 * of that glyph, so a marker attached to one entry would be reproduced at
 * every position that glyph is drawn — not just the intended one. There is
 * no way to make a glyph-keyed marker positionally correct in general.
 */
function rebuildEntriesWithTagTargets(entries: BfCharEntry[]): BfCharEntry[] {
  return entries.map((entry) => {
    const chars = decodeCMapTargetChars(entry.targetHex);
    const tagHex = chars
      .map((ch) => surrogatePairHex(UNICODE_TAG_BASE + (ch.codePointAt(0) as number)))
      .join("");
    return { glyphHex: entry.glyphHex, targetHex: tagHex };
  });
}

/**
 * Builds a ToUnicode CMap text stream using the identical template pdf-lib's
 * own `CMap.js` (`fillCmapTemplate`) writes, so the rebuilt stream is
 * structurally indistinguishable from (and just as parseable as) pdf-lib's
 * original — only the bfchar targets differ.
 */
function buildToUnicodeCMapText(entries: BfCharEntry[]): string {
  const bfCharLines = entries.map((e) => `<${e.glyphHex}><${e.targetHex}>`).join("\n");
  return (
    "/CIDInit /ProcSet findresource begin\n" +
    "12 dict begin\n" +
    "begincmap\n" +
    "/CIDSystemInfo <<\n" +
    "  /Registry (Adobe)\n" +
    "  /Ordering (UCS)\n" +
    "  /Supplement 0\n" +
    ">> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n" +
    "/CMapType 2 def\n" +
    "1 begincodespacerange\n" +
    "<0000><ffff>\n" +
    "endcodespacerange\n" +
    `${entries.length} beginbfchar\n` +
    `${bfCharLines}\n` +
    "endbfchar\n" +
    "endcmap\n" +
    "CMapName currentdict /CMap defineresource pop\n" +
    "end\n" +
    "end"
  );
}

/**
 * Draws the payload exactly like `render_mode_3` (invisible text-rendering
 * mode 3), using a dedicated `embedKoreanFont()` instance (ASCII-complete;
 * the same HarfBuzz-pre-subset + pdf-lib CID-keyed embedding pipeline
 * already used for `payloadLanguage="ko"` — never shared with any visible
 * text on the page, so its ToUnicode CMap only ever contains glyphs from
 * this payload). Lets `doc.save()` run once to materialize pdf-lib's own
 * normal Type0/CIDFontType2 font + ASCII ToUnicode CMap (an unavoidable,
 * harmless intermediate artifact of pdf-lib's lazy font embedding), reloads
 * those bytes via `PDFDocument.load()` (public API), then — using ONLY
 * public `PDFDict`/`PDFName`/`PDFStream`/`PDFContext` APIs, the same
 * primitives `inject-xmp-only.ts` already uses for its own `/Metadata`
 * stream surgery — locates the font dict via the exact resource key
 * `page.node.newFontDictionary()` returned (resource keys survive a
 * save/reload cycle verbatim) and its `/ToUnicode` stream, rebuilds every
 * bfchar target as Unicode-Tag-block codepoints (no BEGIN/CANCEL framing —
 * see below), and reassigns the font dict's `/ToUnicode` key to the rebuilt
 * stream. Round 2 addendum §7 / plan session 20260822-190520
 * architecture_decisions #1.
 *
 * **Why no BEGIN/CANCEL framing (removed; AMENDED post-launch fix):** the
 * original design attached a BEGIN marker to whichever glyph was
 * first-to-appear (CMap-write order) and a CANCEL marker to whichever glyph
 * was last-to-appear, intending to let a decoder unambiguously locate the
 * payload run when embedded inside other extracted text. That design is
 * structurally unsound for a ToUnicode CMap: the CMap maps GLYPH ID ->
 * unicode target, so if the marked glyph is drawn more than once (a common
 * letter recurring anywhere in an ordinary sentence — e.g. 'o' or the
 * instruction's own first character reappearing later), a real
 * content-stream-based extractor (poppler's `pdftotext`, etc.) reproduces
 * the SAME marker at EVERY occurrence of that glyph, not just the intended
 * one — corrupting `decodeUnicodeTags()`'s framed-run search (verified:
 * reproducing the bug report's realistic instruction, whose first
 * character 'o' recurs in "control"/"no", made the framed decode return an
 * arbitrary truncated mid-sentence fragment instead of the actual payload).
 * There is no glyph-keyed way to make positional framing correct in
 * general, so framing is dropped entirely: every drawn character maps
 * directly to its own tag codepoint, and `decodeUnicodeTags()`'s tolerant
 * "maximal run of payload-range tag characters" fallback — always the
 * primary and only path a decoder needs for THIS injector's output, since
 * no ordinary page content uses the Unicode Tags block — delimits the
 * payload from surrounding text without needing any marker at all. See
 * `readUnicodeTagsPayload`'s module doc for the exact guarantee this
 * provides.
 */
export async function injectUnicodeTags(
  input: InjectUnicodeTagsInput,
): Promise<InjectUnicodeTagsResult> {
  try {
    const page = input.doc.getPage(input.pageIndex);
    const font: PDFFont = await input.embedFont(input.doc, input.instruction);
    const fontSize = input.fontSize ?? 1;
    const lineHeight = fontSize * 1.2;
    const maxWidth = input.maxWidth ?? page.getWidth() - 2 * DEFAULT_MARGIN_X;

    const lines = wrapTextToLines(input.instruction, font, fontSize, maxWidth);
    const layout = layoutTextBlock({
      pageWidth: page.getWidth(),
      pageHeight: page.getHeight(),
      lines,
      fontSize,
      lineHeight,
      maxWidth,
      position: input.position,
      x: input.x,
      y: input.y,
      font,
    });

    // Registers the font in the page's /Resources /Font dict and returns its
    // resource key (e.g. /F1) — deterministic and stable across the
    // intermediate save/reload cycle below (pdf-lib preserves resource-key
    // strings verbatim).
    const fontKey = page.node.newFontDictionary(font.name, font.ref);

    page.pushOperators(
      beginText(),
      setFontAndSize(fontKey, fontSize),
      setTextRenderingMode(TextRenderingMode.Invisible),
    );

    lines.forEach((line, i) => {
      const pos = layout.linePositions[i];
      if (!pos) return;
      page.pushOperators(setTextMatrix(1, 0, 0, 1, pos.x, pos.y), showText(font.encodeText(line)));
    });

    page.pushOperators(endText());

    // Step 1: intermediate save — triggers pdf-lib's own lazy font embedding,
    // materializing a real Type0/CIDFontType2 font + normal ASCII ToUnicode
    // CMap for the glyphs actually drawn above.
    const intermediateBytes = await input.doc.save();

    // Step 2: reload via the fully public PDFDocument.load() API into a
    // second PDFDocument instance.
    const reloaded = await PDFDocument.load(intermediateBytes);
    const reloadedPage = reloaded.getPage(input.pageIndex);

    // Step 3: locate the font dict (via the same resource key) and its
    // /ToUnicode stream, using only public PDFDict/PDFName/PDFStream APIs.
    const resources = reloadedPage.node.Resources();
    if (!resources) {
      throw new InjectionFailedError(
        "unicode_tags injection failed: reloaded page has no /Resources dict (expected the font dict registered above)",
      );
    }
    const fontsDict = resources.lookup(PDFName.of("Font"), PDFDict);
    const fontDict = fontsDict.lookup(fontKey, PDFDict);
    // pdf-lib compresses stream bodies (FlateDecode) by default on save(), so
    // the reloaded ToUnicode stream is a PDFRawStream holding still-encoded
    // bytes — decodePDFRawStream (a public, top-level pdf-lib export) is the
    // documented way to get its decoded contents, same in kind as
    // PDFStream.getContents() but filter-aware. `instanceof` narrows the
    // public PDFStream lookup result to the concrete PDFRawStream subtype
    // decodePDFRawStream expects, with no cast.
    const toUnicodeStream = fontDict.lookup(PDFName.of("ToUnicode"), PDFStream);
    if (!(toUnicodeStream instanceof PDFRawStream)) {
      throw new InjectionFailedError(
        "unicode_tags injection failed: /ToUnicode stream was not a raw stream after the intermediate save/reload",
      );
    }

    // Step 4: regex-parse the existing beginbfchar entries and rebuild them
    // with UTF-16-surrogate-pair-encoded tag targets (no BEGIN/CANCEL
    // framing — see this file's module doc, "Why no BEGIN/CANCEL framing").
    const cmapBytes = decodePDFRawStream(toUnicodeStream).decode();
    const cmapText = new TextDecoder("utf-8").decode(cmapBytes);
    const entries = parseBfCharEntries(cmapText);
    if (entries.length === 0) {
      throw new InjectionFailedError(
        "unicode_tags injection failed: no beginbfchar entries found in the intermediate ToUnicode CMap",
      );
    }
    const rebuiltEntries = rebuildEntriesWithTagTargets(entries);
    const newCmapBytes = new TextEncoder().encode(buildToUnicodeCMapText(rebuiltEntries));

    // Step 5: register the rebuilt CMap as a new, uncompressed stream (same
    // kind of raw stream registration inject-xmp-only.ts uses for its own
    // XMP stream) and reassign the font dict's /ToUnicode key to it.
    const newStream = reloaded.context.stream(newCmapBytes, {});
    const newStreamRef = reloaded.context.register(newStream);
    fontDict.set(PDFName.of("ToUnicode"), newStreamRef);

    // Step 6: return the reloaded, now-CMap-rewritten PDFDocument instance —
    // inject.ts's dispatcher swaps its local `doc` to this before its own
    // final save/reload/geometry-check step (which then runs unchanged).
    return { boundingBox: layout.boundingBox, fontSize, doc: reloaded };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`unicode_tags injection failed: ${(err as Error).message}`);
  }
}
