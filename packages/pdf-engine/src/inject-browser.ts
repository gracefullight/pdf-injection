import type { InjectPdfInput, InjectPdfResult } from "@pdf-injection/contracts";
import { FontUnavailableError } from "./errors";
import { type InjectPlatform, injectPdfWith } from "./inject-core";

/**
 * The browser platform for the injection dispatcher — used by `apps/web`'s
 * local (server-free) mode, where the whole pipeline runs on-device.
 *
 * Deliberately omits the three Node-only capabilities (see `InjectPlatform`):
 *
 * | capability | why it is server-only |
 * |---|---|
 * | CJK font embedding (`payloadLanguage` `"ko"`/`"zh"`) | the font subset is read from `PDFI_FONT_DIR` on disk and pre-subset with a WASM HarfBuzz build |
 * | `image_only` | rasterizes through `@napi-rs/canvas`, a native module |
 * | `unicode_tags` | draws with that same disk-loaded font subset |
 *
 * Everything else — `white_text`, `render_mode_3`, `visible_positive_control`,
 * `xmp_only`, `info_dict`, `freetext_annot`, `acroform_field` — is pure
 * `pdf-lib` and runs identically here and on the server, through the *same*
 * `injectPdfWith` orchestration (no duplicated logic that could drift).
 */
const BROWSER_PLATFORM: InjectPlatform = {
  embedCjkFont: async (language) => {
    throw new FontUnavailableError(
      `payloadLanguage="${language}" needs the bundled CJK font subset, which is only available ` +
        'on the server. Use payloadLanguage="en", or generate against a running API server.',
    );
  },
  // injectImageOnly / injectUnicodeTags intentionally absent — the dispatcher
  // throws a descriptive InjectionFailedError for those modes.
};

/** Injection modes that work fully client-side, in dispatcher/UI order. */
export const BROWSER_SUPPORTED_MODES = [
  "white_text",
  "render_mode_3",
  "visible_positive_control",
  "xmp_only",
  "freetext_annot",
  "acroform_field",
  "info_dict",
] as const satisfies ReadonlyArray<InjectPdfInput["mode"]>;

/** True when `mode` can be generated without a server. */
export function isBrowserSupportedMode(mode: InjectPdfInput["mode"]): boolean {
  return (BROWSER_SUPPORTED_MODES as readonly string[]).includes(mode);
}

/**
 * Runs the injection pipeline entirely in the browser. Same input/output
 * contract as the server's `injectPdf`; throws `FontUnavailableError` for CJK
 * payloads and `InjectionFailedError` for `image_only`/`unicode_tags`.
 */
export async function injectPdfInBrowser(input: InjectPdfInput): Promise<InjectPdfResult> {
  return injectPdfWith(BROWSER_PLATFORM, input);
}
