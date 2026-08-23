import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";
import { FontUnavailableError } from "./errors";
import { instantiateHbSubset, subsetTrueTypeFont } from "./hb-subset";
import type { CjkPayloadLanguage } from "./payload-language";

/**
 * Browser twin of `korean-font.ts`'s `embedCjkFont`, for `payloadLanguage`
 * `"ko"`/`"zh"` (and `unicode_tags`, which draws with the same font) when the
 * pipeline runs on-device.
 *
 * Same two-stage pipeline as the server — HarfBuzz pre-subset, then pdf-lib's
 * own `{subset:true}` CID embedding — because either stage alone is not
 * enough: pdf-lib's subsetter on a full CJK font drops strokes from composite
 * glyphs (measured at ~13% fewer ink pixels), and skipping pdf-lib's pass
 * loses the CID-keyed embedding that makes the text extractable. The only
 * difference is where the bytes come from: `node:fs` on the server, caller-
 * supplied `fetch` here (`CjkFontSources`), because a browser has no disk and
 * the fonts are 6–10 MB assets that must not be eagerly bundled.
 */

/** Printable ASCII, always kept in the subset so mixed-script text still renders. */
const ASCII_PRINTABLE =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

const LANGUAGE_LABELS: Record<CjkPayloadLanguage, string> = { ko: "Korean", zh: "Chinese" };

/**
 * How the host app obtains the two large binary assets. `apps/web` implements
 * these with Vite asset URLs + `fetch`, so the font is downloaded only when a
 * CJK payload is actually selected.
 */
export interface CjkFontSources {
  /** Raw bytes of the bundled Noto Sans KR / SC TrueType file. */
  fontBytes(language: CjkPayloadLanguage): Promise<Uint8Array>;
  /** Raw bytes (or a compiled module) of `harfbuzzjs/hb-subset.wasm`. */
  hbSubsetWasm(): Promise<BufferSource | WebAssembly.Module>;
}

/**
 * Builds an `embedCjkFont` implementation bound to `sources`. The HarfBuzz
 * instance and the downloaded font bytes are cached for the lifetime of the
 * embedder, so only the first CJK job pays the download/instantiation cost.
 */
export function createCjkFontEmbedder(sources: CjkFontSources) {
  let hbPromise: Promise<Awaited<ReturnType<typeof instantiateHbSubset>>> | null = null;
  const fontCache = new Map<CjkPayloadLanguage, Promise<Uint8Array>>();
  const registeredDocs = new WeakSet<PDFDocument>();

  return async function embedCjkFont(
    language: CjkPayloadLanguage,
    doc: PDFDocument,
    text: string,
  ): Promise<PDFFont> {
    if (!registeredDocs.has(doc)) {
      doc.registerFontkit(fontkit);
      registeredDocs.add(doc);
    }

    let fontBytes: Uint8Array;
    try {
      const cached = fontCache.get(language) ?? sources.fontBytes(language);
      fontCache.set(language, cached);
      fontBytes = await cached;
    } catch (err) {
      fontCache.delete(language); // a failed download must not be cached
      throw new FontUnavailableError(
        `Could not load the ${LANGUAGE_LABELS[language]} CJK font: ${(err as Error).message}`,
      );
    }

    let subsetBytes: Uint8Array;
    try {
      hbPromise = hbPromise ?? sources.hbSubsetWasm().then(instantiateHbSubset);
      const hb = await hbPromise;
      subsetBytes = subsetTrueTypeFont(hb, fontBytes, text + ASCII_PRINTABLE);
    } catch (err) {
      hbPromise = null;
      throw new FontUnavailableError(
        `Failed to pre-subset the ${LANGUAGE_LABELS[language]} CJK font with HarfBuzz: ${(err as Error).message}`,
      );
    }

    try {
      return await doc.embedFont(subsetBytes, { subset: true });
    } catch (err) {
      throw new FontUnavailableError(
        `Failed to embed the ${LANGUAGE_LABELS[language]} CJK font: ${(err as Error).message}`,
      );
    }
  };
}
