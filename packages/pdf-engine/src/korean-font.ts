/// <reference path="./subset-font.d.ts" />
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import subsetFont from "subset-font";
import { FontUnavailableError } from "./errors";

/** PDFI_FONT_DIR default — see .agents/results/api-contracts/pdf-injection-phase3-5-api.md §0.2 */
const DEFAULT_FONT_DIR = path.join(import.meta.dir, "..", "fonts");

/**
 * The two non-"en" `PayloadLanguage` values, each requiring its own bundled
 * CJK font (see `FONT_FILENAMES` below for why they can't share one).
 */
import type { CjkPayloadLanguage } from "./payload-language";

export type { CjkPayloadLanguage } from "./payload-language";

// Cycle-4 QA fix (ko): a genuine static Regular instance (not the raw Google
// Fonts variable font used through cycle 3), served by Google's font CDN
// (fonts.gstatic.com, resolved via the fonts.googleapis.com/css2 API — same
// upstream OFL-licensed font project as before, no license change) — see
// the doc comment on embedCjkFont for the full provenance and why this,
// combined with HarfBuzz pre-subsetting, finally fixes both the weight and
// the rendering/extraction bugs documented through cycle 3.
//
// zh: NotoSansSC-Regular.ttf is a static Regular instance (wght=400)
// instanced from the OFL Noto Sans SC variable font, verified end-to-end
// through the same HarfBuzz-pre-subset + pdf-lib subset:true pipeline. It is
// a *separate* font from NotoSansKR-Regular.ttf — the KR font covers
// Traditional Chinese reasonably well but Simplified Chinese poorly (misses
// common Simplified-only forms such as 术/债/务/设/计/熵), so `"zh"` is keyed
// to its own font file rather than reusing the `"ko"` one.
const FONT_FILENAMES: Record<CjkPayloadLanguage, string> = {
  ko: "NotoSansKR-Regular.ttf",
  zh: "NotoSansSC-Regular.ttf",
};

/** Human-readable language name, used in error messages. */
const LANGUAGE_LABELS: Record<CjkPayloadLanguage, string> = {
  ko: "Korean",
  zh: "Chinese",
};

/** Font family display name, used in error messages. Both are OFL-licensed — see fonts/OFL.txt. */
const FONT_DISPLAY_NAMES: Record<CjkPayloadLanguage, string> = {
  ko: "Noto Sans KR",
  zh: "Noto Sans SC",
};

function resolveFontDir(): string {
  return process.env.PDFI_FONT_DIR ?? DEFAULT_FONT_DIR;
}

/** Cached per resolved font path (tests may point PDFI_FONT_DIR at different dirs). */
const fontBytesCache = new Map<string, Uint8Array>();
const fontkitRegisteredDocs = new WeakSet<PDFDocument>();

async function loadFontBytes(language: CjkPayloadLanguage): Promise<Uint8Array> {
  const fontPath = path.join(resolveFontDir(), FONT_FILENAMES[language]);
  const cached = fontBytesCache.get(fontPath);
  if (cached) return cached;

  try {
    const bytes = new Uint8Array(await readFile(fontPath));
    fontBytesCache.set(fontPath, bytes);
    return bytes;
  } catch (err) {
    throw new FontUnavailableError(
      `${LANGUAGE_LABELS[language]} (payloadLanguage="${language}") CJK font not found at ` +
        `${fontPath}. Set PDFI_FONT_DIR or restore packages/pdf-engine/fonts/${FONT_FILENAMES[language]} ` +
        `(OFL-licensed ${FONT_DISPLAY_NAMES[language]}). (${(err as Error).message})`,
    );
  }
}

/** Printable ASCII (0x20-0x7E) — always kept in the HarfBuzz pre-subset alongside the payload text. */
const ASCII_PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) =>
  String.fromCharCode(0x20 + i),
).join("");

/**
 * **Cycle-4 fix (resolves the cycle-2/3 "accepted debt").** Root cause
 * finally isolated: `@pdf-lib/fontkit`'s OWN TrueType subsetter corrupts
 * composite-glyph outlines for a glyph-rich CJK font (cycles 2-3, 4 font
 * files tried across 2 official sources — all failed the same way when
 * pdf-lib subsetted them), AND separately, `pdf-lib.embedFont(bytes,
 * {subset:false})` uses a *simple-font* (single-byte, ≤256-glyph) embedding
 * strategy that is fundamentally incompatible with a large CJK glyph set —
 * it silently mis-maps low-index characters (confirmed: substituting the
 * space character for a NON-BREAKING SPACE reproduced the identical
 * corruption, proving it's a glyph-index/encoding-table bug tied to the
 * *embedding strategy itself*, not the specific codepoint drawn, and not
 * fixable by pre-subsetting the input — the corruption happens in pdf-lib's
 * draw-time encoding, not in subsetting). `{subset:true}` uses the correct
 * CID-keyed (Type0) strategy needed for large glyph sets, but routes
 * through pdf-lib's own buggy subsetter.
 *
 * **Fix: subset with HarfBuzz (`subset-font`, BSD-3-Clause, wraps
 * `harfbuzzjs`, MIT/Apache-2.0) BEFORE handing the font to pdf-lib**,
 * keeping only the current payload's codepoints + printable ASCII, then
 * embed the (already tiny) result with `{subset:true}` so pdf-lib's
 * CID-keyed embedding path is used — pdf-lib's own subsetter then operates
 * on an already-minimal font and does not hit the composite-glyph bug. This
 * "double subset" (HarfBuzz, then pdf-lib again) is the only one of 6
 * font-file × embedding-strategy combinations tried across cycles 2-4 that
 * passes BOTH checks simultaneously:
 * - Rasterization (`@napi-rs/canvas`): complete, correctly-shaped glyphs at
 *   the correct weight (paired with each language's static-Regular font —
 *   see `FONT_FILENAMES`'s comment).
 * - Extraction (`pdfjs-dist` `getTextContent()`): exact match, confirmed for
 *   `white_text`, `render_mode_3`, and `visible_positive_control` alike, in
 *   `korean-payload.test.ts`.
 *
 * Output size is tiny (a few KB — smaller than the naive pdf-lib-only
 * subset attempted in cycle 2, since HarfBuzz's subsetter is more
 * aggressive), well inside the "<400KB delta" budget for every mode.
 *
 * `language` selects which bundled font file to load (`"ko"` -> Noto Sans
 * KR, `"zh"` -> Noto Sans SC — see `FONT_FILENAMES`). `text` should be the
 * exact instruction being drawn (the HarfBuzz subset is scoped per-call to
 * that text + printable ASCII — cheap, millisecond-level, so no cross-call
 * caching is needed).
 */
export async function embedCjkFont(
  language: CjkPayloadLanguage,
  doc: PDFDocument,
  text: string,
): Promise<PDFFont> {
  if (!fontkitRegisteredDocs.has(doc)) {
    doc.registerFontkit(fontkit);
    fontkitRegisteredDocs.add(doc);
  }

  const rawFontBytes = await loadFontBytes(language);
  const keepText = text + ASCII_PRINTABLE;

  let hbSubsetBytes: Buffer;
  try {
    hbSubsetBytes = await subsetFont(Buffer.from(rawFontBytes), keepText, { targetFormat: "sfnt" });
  } catch (err) {
    throw new FontUnavailableError(
      `Failed to pre-subset the ${LANGUAGE_LABELS[language]} CJK font with HarfBuzz: ${(err as Error).message}`,
    );
  }

  try {
    // subset:true here is pdf-lib's OWN (separate) subsetting pass over the
    // already-HarfBuzz-subsetted font — see the doc comment above for why
    // this combination, and not either step alone, is what works.
    return await doc.embedFont(new Uint8Array(hbSubsetBytes), { subset: true });
  } catch (err) {
    throw new FontUnavailableError(
      `Failed to embed the ${LANGUAGE_LABELS[language]} CJK font: ${(err as Error).message}`,
    );
  }
}

/** True if the bundled CJK font file for `language` is present under the resolved PDFI_FONT_DIR. */
async function cjkFontAvailable(language: CjkPayloadLanguage): Promise<boolean> {
  try {
    await loadFontBytes(language);
    return true;
  } catch {
    return false;
  }
}

/** `embedCjkFont("ko", doc, text)` — kept as a named export for existing call sites. */
export async function embedKoreanFont(doc: PDFDocument, text: string): Promise<PDFFont> {
  return embedCjkFont("ko", doc, text);
}

/** `embedCjkFont("zh", doc, text)` — kept as a named export, mirroring `embedKoreanFont`. */
export async function embedChineseFont(doc: PDFDocument, text: string): Promise<PDFFont> {
  return embedCjkFont("zh", doc, text);
}

/** True if the Noto Sans KR font file is present under the resolved PDFI_FONT_DIR. Used by health.features.koPayload. */
export async function koreanFontAvailable(): Promise<boolean> {
  return cjkFontAvailable("ko");
}

/** True if the Noto Sans SC font file is present under the resolved PDFI_FONT_DIR. Used by health.features.zhPayload. */
export async function chineseFontAvailable(): Promise<boolean> {
  return cjkFontAvailable("zh");
}
