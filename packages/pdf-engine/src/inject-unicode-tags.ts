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
import { type BfCharEntry, parseBfCharEntries } from "./cmap-bfchar";
import { InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { embedKoreanFont } from "./korean-font";
import { DEFAULT_MARGIN_X, layoutTextBlock, wrapTextToLines } from "./text-layout";
import { UNICODE_TAG_BASE, UNICODE_TAG_BEGIN, UNICODE_TAG_CANCEL } from "./unicode-tags";

export interface InjectUnicodeTagsInput {
  doc: PDFDocument;
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
 * Rebuilds each bfchar entry's target as a Unicode-Tag-block codepoint
 * (U+E0000 + the entry's original ASCII codepoint), UTF-16-surrogate-pair
 * encoded. The FIRST entry (in CMap-write order, which pdf-lib's
 * `CustomFontSubsetEmbedder` assigns in first-appearance order of the drawn
 * text's glyphs — see this file's module doc) additionally gets the BEGIN
 * marker's surrogate pair prefixed, and the LAST entry gets the CANCEL
 * marker's surrogate pair suffixed — both as extra concatenated hex groups
 * within the SAME multi-codepoint bfchar target (PDF-spec-legal; the exact
 * mechanism pdf-lib's own CMap builder uses for ligature glyphs).
 */
function rebuildEntriesWithTagTargets(entries: BfCharEntry[]): BfCharEntry[] {
  return entries.map((entry, i) => {
    const asciiCode = Number.parseInt(entry.targetHex, 16);
    const tagHex = surrogatePairHex(UNICODE_TAG_BASE + asciiCode);
    const beginHex = i === 0 ? surrogatePairHex(UNICODE_TAG_BEGIN) : "";
    const cancelHex = i === entries.length - 1 ? surrogatePairHex(UNICODE_TAG_CANCEL) : "";
    return { glyphHex: entry.glyphHex, targetHex: `${beginHex}${tagHex}${cancelHex}` };
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
 * save/reload cycle verbatim) and its `/ToUnicode` stream, rebuilds the
 * bfchar targets as Unicode-Tag-block codepoints framed with BEGIN/CANCEL
 * markers, and reassigns the font dict's `/ToUnicode` key to the rebuilt
 * stream. Round 2 addendum §7 / plan session 20260822-190520
 * architecture_decisions #1.
 */
export async function injectUnicodeTags(
  input: InjectUnicodeTagsInput,
): Promise<InjectUnicodeTagsResult> {
  try {
    const page = input.doc.getPage(input.pageIndex);
    const font: PDFFont = await embedKoreanFont(input.doc, input.instruction);
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
    // with UTF-16-surrogate-pair-encoded, BEGIN/CANCEL-framed tag targets.
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
