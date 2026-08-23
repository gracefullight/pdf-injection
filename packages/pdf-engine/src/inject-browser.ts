import type { InjectPdfInput, InjectPdfResult } from "@pdf-injection/contracts";
import { type CjkFontSources, createCjkFontEmbedder } from "./browser-cjk-font";
import { FontUnavailableError } from "./errors";
import { type InjectPlatform, injectPdfWith } from "./inject-core";
import { injectImageOnlyInBrowser } from "./inject-image-only-browser";
import { injectUnicodeTags } from "./inject-unicode-tags";

/**
 * The browser platform for the injection dispatcher — used by `apps/web`'s
 * local (server-free) mode, where the whole pipeline runs on-device.
 *
 * Every one of the nine modes and all three payload languages work here; the
 * platform differs from the Node one only in *where the two heavy assets come
 * from*, because a browser has no disk:
 *
 * | capability | server | browser |
 * |---|---|---|
 * | rasterizing `image_only` | `@napi-rs/canvas` | the browser's own canvas |
 * | CJK font (`ko`/`zh`, and `unicode_tags`) | font + HarfBuzz wasm read from disk | the same two assets fetched, supplied by the host app via `CjkFontSources` |
 *
 * The subsetting itself is byte-for-byte identical to the server's
 * (`test/hb-subset.test.ts`), so CJK text renders and extracts the same.
 *
 * Without `CjkFontSources`, CJK payloads and `unicode_tags` fail with a
 * `FontUnavailableError` explaining that the host app has not wired the font
 * assets up — the other seven modes still work with no configuration at all.
 */
export interface BrowserPlatformOptions {
  /** How to fetch the CJK font and the HarfBuzz wasm. Omit to disable CJK payloads. */
  cjkFontSources?: CjkFontSources;
}

const NO_CJK_FONT_SOURCES: InjectPlatform["embedCjkFont"] = async (language) => {
  throw new FontUnavailableError(
    `payloadLanguage="${language}" needs the CJK font assets, which this app has not made ` +
      'available to the in-browser engine. Use payloadLanguage="en", or generate against an API server.',
  );
};

/** Builds the browser platform. Cheap; the font/wasm downloads are lazy and cached inside. */
export function createBrowserPlatform(options: BrowserPlatformOptions = {}): InjectPlatform {
  const embedCjkFont = options.cjkFontSources
    ? createCjkFontEmbedder(options.cjkFontSources)
    : NO_CJK_FONT_SOURCES;

  return {
    embedCjkFont,
    injectImageOnly: injectImageOnlyInBrowser,
    // unicode_tags draws with the same ASCII-complete CJK subset the server
    // uses (`embedKoreanFont`); the glyphs are invisible (render mode 3), only
    // the ToUnicode CMap matters — see inject-unicode-tags.ts.
    injectUnicodeTags: (input) =>
      injectUnicodeTags({
        ...input,
        embedFont: (doc, text) => embedCjkFont("ko", doc, text),
      }),
  };
}

/** Every injection mode is available in the browser (given `cjkFontSources` for the CJK ones). */
export const BROWSER_SUPPORTED_MODES = [
  "white_text",
  "render_mode_3",
  "visible_positive_control",
  "xmp_only",
  "unicode_tags",
  "image_only",
  "freetext_annot",
  "acroform_field",
  "info_dict",
] as const satisfies ReadonlyArray<InjectPdfInput["mode"]>;

/** True when `mode` can be generated without a server. */
export function isBrowserSupportedMode(mode: InjectPdfInput["mode"]): boolean {
  return (BROWSER_SUPPORTED_MODES as readonly string[]).includes(mode);
}

/**
 * Runs the injection pipeline entirely in the browser.
 *
 * Pass a platform built once with `createBrowserPlatform()` when generating
 * repeatedly: it caches the HarfBuzz instance and the downloaded font bytes,
 * so only the first CJK job pays for them. Omitting it builds a throwaway
 * platform (fine for a one-off, and for the seven modes that need no font).
 */
export async function injectPdfInBrowser(
  input: InjectPdfInput,
  platform: InjectPlatform = createBrowserPlatform(),
): Promise<InjectPdfResult> {
  return injectPdfWith(platform, input);
}
