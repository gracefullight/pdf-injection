export * from "./cmap-bfchar";
export * from "./compare-geometry";
export * from "./errors";
export * from "./inject";
export * from "./inject-acroform-field";
export * from "./inject-actual-text";
export * from "./inject-freetext-annot";
// The Node wrappers own the `injectImageOnly` / `injectUnicodeTags` names for
// existing callers; the runtime-agnostic cores are exported under their
// `*With` names from the modules below.
export {
  IMAGE_ONLY_DEFAULT_FONT_SIZE,
  IMAGE_ONLY_PROMPT_SHA256_KEY,
  type InjectImageOnlyInput,
  type InjectImageOnlyResult,
  injectImageOnlyWith,
  readStampedImagePresence,
  type StampedImagePresence,
} from "./inject-image-only";
export * from "./inject-image-only-node";
export * from "./inject-info-dict";
export * from "./inject-render-mode-3";
export {
  type InjectUnicodeTagsInput,
  type InjectUnicodeTagsResult,
  injectUnicodeTags as injectUnicodeTagsWith,
  type UnicodeTagsFontEmbedder,
} from "./inject-unicode-tags";
export * from "./inject-unicode-tags-node";
export * from "./inject-visible-control";
export * from "./inject-white-text";
export * from "./inject-xmp-only";
export * from "./inspect-source";
export * from "./korean-font";
export * from "./manifest";
export * from "./native-canvas";
export * from "./normalize-prompt";
export * from "./page-geometry";
export * from "./pdf-standard-security";
export * from "./read-unicode-tags-payload";
export * from "./resolve-target-page";
export * from "./text-layout";
export * from "./unicode-tags";
