import type { CjkFontSources } from "@pdf-injection/pdf-engine/browser";
// The two bundled CJK fonts and the HarfBuzz subsetter, referenced as Vite
// asset URLs (`?url`) rather than imported as modules: they are 6 MB, 10 MB and
// 620 KB, so they must be emitted as separate files and fetched on demand —
// only when a Korean/Chinese payload or `unicode_tags` is actually generated.
// Nothing here is downloaded at page load.
import hbSubsetWasmUrl from "harfbuzzjs/hb-subset.wasm?url";
import notoSansKrUrl from "../../../../../packages/pdf-engine/fonts/NotoSansKR-Regular.ttf?url";
import notoSansScUrl from "../../../../../packages/pdf-engine/fonts/NotoSansSC-Regular.ttf?url";

/**
 * Supplies the in-browser engine with the same font bytes and HarfBuzz
 * subsetter the server reads from disk, so on-device CJK payloads render and
 * extract identically (see `packages/pdf-engine/src/browser-cjk-font.ts`).
 */

const FONT_URLS = {
  ko: notoSansKrUrl,
  zh: notoSansScUrl,
} as const;

async function fetchBytes(url: string, what: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${what} (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export const cjkFontSources: CjkFontSources = {
  fontBytes: (language) =>
    fetchBytes(FONT_URLS[language], `the ${language === "ko" ? "Korean" : "Chinese"} font`),
  hbSubsetWasm: () => fetchBytes(hbSubsetWasmUrl, "the HarfBuzz subsetter"),
};
