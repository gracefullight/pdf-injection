import type { PayloadLanguage } from "@pdf-injection/contracts";

/**
 * The payload languages that need a CJK font subset embedded (as opposed to
 * `"en"`, which draws with a standard-14 font).
 *
 * Declared here rather than in `korean-font.ts` so the runtime-agnostic
 * dispatcher (`inject-core.ts`) can reference the type without importing that
 * module at all — `korean-font.ts` reads the font from disk (`node:fs`), and
 * even a type-only import of it would leave the browser entry's purity
 * dependent on the bundler eliding type imports. See
 * `test/browser-entry-purity.test.ts`.
 */
export type CjkPayloadLanguage = "ko" | "zh";

/** Narrows a payload language to the ones requiring a CJK font subset. */
export function isCjkPayloadLanguage(language: PayloadLanguage): language is CjkPayloadLanguage {
  return language === "ko" || language === "zh";
}
