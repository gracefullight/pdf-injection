import type { InjectPdfInput, InjectPdfResult } from "@pdf-injection/contracts";
import { type InjectPlatform, injectPdfWith } from "./inject-core";
import { injectImageOnly } from "./inject-image-only";
import { injectUnicodeTags } from "./inject-unicode-tags";
import { embedCjkFont } from "./korean-font";

/**
 * The Node/Bun platform for the injection dispatcher: every mode is
 * available, because this runtime can read the bundled CJK font from disk
 * (`korean-font.ts`) and resolve the native canvas (`inject-image-only.ts`).
 *
 * The orchestration itself lives in `inject-core.ts` and is shared verbatim
 * with `inject-browser.ts`; only these three capability hooks differ. Keeping
 * the Node-only modules out of the core's static import graph is what makes a
 * browser build possible at all — see `InjectPlatform`'s doc comment.
 */
const NODE_PLATFORM: InjectPlatform = {
  embedCjkFont,
  injectImageOnly,
  injectUnicodeTags,
};

/**
 * Injection engine entry point for the server (`apps/api`) and every Node/Bun
 * caller. Unchanged public API: see `injectPdfWith` in `inject-core.ts` for
 * the full behaviour, errors and PRD references.
 */
export async function injectPdf(input: InjectPdfInput): Promise<InjectPdfResult> {
  return injectPdfWith(NODE_PLATFORM, input);
}

export type { InjectPlatform } from "./inject-core";
export { injectPdfWith } from "./inject-core";
