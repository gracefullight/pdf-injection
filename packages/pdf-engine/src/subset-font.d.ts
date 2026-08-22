// `subset-font` ships no type declarations (plain JS package). Minimal
// ambient types for the subset of its API this codebase uses. See
// https://github.com/papandreou/subset-font for the full API.
declare module "subset-font" {
  export interface SubsetFontOptions {
    targetFormat?: "sfnt" | "woff" | "woff2" | "truetype";
    preserveNameIds?: number[];
    variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }>;
    noLayoutClosure?: boolean;
  }

  export default function subsetFont(
    buffer: Buffer | Uint8Array,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
