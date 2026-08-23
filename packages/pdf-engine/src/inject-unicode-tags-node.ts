import {
  type InjectUnicodeTagsInput,
  type InjectUnicodeTagsResult,
  injectUnicodeTags as injectUnicodeTagsWith,
} from "./inject-unicode-tags";
import { embedKoreanFont } from "./korean-font";

/**
 * `unicode_tags` on the Node/Bun platform: the shared injector bound to the
 * on-disk bundled CJK font. Unchanged public API for `apps/api` and existing
 * tests; the browser binds the same injector to a fetched font instead.
 */
export async function injectUnicodeTags(
  input: Omit<InjectUnicodeTagsInput, "embedFont">,
): Promise<InjectUnicodeTagsResult> {
  return injectUnicodeTagsWith({ ...input, embedFont: embedKoreanFont });
}
