import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
} from "pdf-lib";
import { parseBfCharEntries } from "./cmap-bfchar";
import { decodeUnicodeTags } from "./unicode-tags";

function utf16HexToString(hex: string): string {
  const units: number[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    units.push(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...units);
}

/**
 * Reads back the Unicode Tag payload(s) embedded by `injectUnicodeTags()`,
 * using ONLY public pdf-lib APIs — bypasses pdfjs-dist's `getTextContent()`
 * entirely, which unconditionally filters out every glyph whose ToUnicode
 * target is Unicode General Category "Cf" (Format); the whole Unicode Tags
 * block (U+E0000-U+E007F) is Cf by definition, so `extractText()`
 * (`@pdf-injection/validation`, pdfjs-dist-based) can never recover this
 * payload on any input — see
 * `packages/pdf-engine/test/inject-unicode-tags.test.ts`'s dedicated
 * documentation test for the full, independently-verified finding. This is
 * the ONLY reliable way to confirm a `unicode_tags` injection actually took
 * effect on a given file's final saved bytes.
 *
 * Scans every page's `/Font` resources for a `/ToUnicode` CMap stream,
 * parses its `beginbfchar...endbfchar` entries, and tag-decodes each
 * entry's target via `decodeUnicodeTags()`.
 *
 * pdf-lib's ToUnicode CMap maps GLYPH ID -> unicode target — one entry per
 * *unique* glyph, in first-appearance order — not one entry per drawn
 * character position. So the string returned for a given font is the
 * de-duplicated, first-appearance-order sequence of tag-decoded characters
 * drawn with that font, not necessarily byte-identical to the original
 * instruction when it repeats characters. This is sufficient to answer "is
 * a Unicode Tag payload present in this file" — the presence check every
 * caller of this function needs (job creation's post-inject assertion, the
 * benchmark mock provider's `detectInstructionFound`) — without a full
 * content-stream operator parser.
 *
 * `injectUnicodeTags()` writes no BEGIN/CANCEL frame markers (removed —
 * glyph-keyed framing was structurally unable to be positionally correct;
 * see its module doc, "Why no BEGIN/CANCEL framing"), so every `decodeUnicodeTags()`
 * call here always takes its tolerant "maximal run of payload-range tag
 * characters" path, never the framed-run path. A **ligature glyph** (e.g.
 * the glyph fontkit/HarfBuzz GSUB-substitutes for "ffi") decodes to its
 * full multi-character run in one pass through that path — the returned
 * string therefore accounts for every character of every unique glyph with
 * correct per-glyph multiplicity, not just one character per glyph.
 *
 * Returns one string per font (across every page) that has at least one
 * tag-decodable `/ToUnicode` entry; an empty array when no font in the
 * document carries a Unicode Tag payload (e.g. the `original` condition, or
 * any non-`unicode_tags` injection mode — every plain-ASCII ToUnicode CMap
 * decodes to `[]` per character via `decodeUnicodeTags`, so this is a safe,
 * structural no-op for those, not merely an empirically-observed one).
 */
export async function readUnicodeTagsPayload(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const payloads: string[] = [];

  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex++) {
    const page = doc.getPage(pageIndex);
    const resources = page.node.Resources();
    if (!resources) continue;

    const fontsDict = resources.lookupMaybe(PDFName.of("Font"), PDFDict);
    if (!fontsDict) continue;

    for (const key of fontsDict.keys()) {
      const fontDict = fontsDict.lookupMaybe(key, PDFDict);
      if (!fontDict) continue;

      const toUnicode = fontDict.lookupMaybe(PDFName.of("ToUnicode"), PDFStream);
      if (!(toUnicode instanceof PDFRawStream)) continue;

      const cmapText = new TextDecoder("utf-8").decode(decodePDFRawStream(toUnicode).decode());
      const entries = parseBfCharEntries(cmapText);

      let decoded = "";
      for (const entry of entries) {
        const target = utf16HexToString(entry.targetHex);
        decoded += decodeUnicodeTags(target).join("");
      }

      if (decoded.length > 0) payloads.push(decoded);
    }
  }

  return payloads;
}
