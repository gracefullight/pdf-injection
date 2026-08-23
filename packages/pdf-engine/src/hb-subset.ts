/**
 * Minimal HarfBuzz `hb-subset` driver that works on any runtime with
 * WebAssembly — including a browser.
 *
 * `subset-font` (BSD-3-Clause, © 2012 Andreas Lind Petersen), which
 * `korean-font.ts` uses on the server, is pure WebAssembly except for one
 * thing: it reads `harfbuzzjs/hb-subset.wasm` off disk with `node:fs`, which
 * makes it unbundlable for the browser. This module performs the same
 * `hb_subset_*` call sequence (adapted from that package's implementation)
 * against wasm bytes the caller supplies however its runtime can — `readFile`
 * on the server, `fetch` in the browser.
 *
 * Scope is deliberately narrower than `subset-font`: no variation-axis
 * pinning, no name-id preservation, no format conversion (both bundled fonts
 * are already `truetype`/sfnt, which is also the output format pdf-lib wants).
 * `test/hb-subset.test.ts` asserts byte-for-byte equality with `subset-font`
 * for the real fonts, so the two paths cannot drift.
 *
 * Node-free by construction — see `test/browser-entry-purity.test.ts`.
 */

/** The `hb-subset.wasm` exports this module calls. */
interface HbSubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(
    data: number,
    length: number,
    memoryMode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_set_clear(set: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_set(input: number, setKind: number): number;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

/** `HB_MEMORY_MODE_WRITABLE` — harfbuzz may mutate the blob we hand it. */
const HB_MEMORY_MODE_WRITABLE = 2;
/** `HB_SUBSET_SETS_LAYOUT_FEATURE_TAG` — the set of OpenType features to keep. */
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

/**
 * Instantiates `hb-subset.wasm`. Callers should cache the result: it is a
 * ~620 KB module and instantiation is the expensive part, not the subsetting.
 */
export async function instantiateHbSubset(
  wasm: BufferSource | WebAssembly.Module,
): Promise<HbSubsetExports> {
  // `WebAssembly.instantiate` is overloaded: a compiled Module resolves to an
  // Instance, raw bytes to a `{ module, instance }` result object. Compile
  // bytes first so there is exactly one shape to handle.
  const module =
    wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm as BufferSource);
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports as unknown as HbSubsetExports;
}

/**
 * Subsets `fontBytes` down to the glyphs needed for `keepText`, keeping every
 * OpenType layout feature (the `--font-features=*` equivalent) so shaping is
 * unaffected. Input and output are both sfnt/truetype.
 */
export function subsetTrueTypeFont(
  hb: HbSubsetExports,
  fontBytes: Uint8Array,
  keepText: string,
): Uint8Array {
  // Re-read `memory.buffer` after every allocation: growing the wasm heap
  // detaches any previously created view.
  const heap = () => new Uint8Array(hb.memory.buffer);

  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) {
    throw new Error("hb_subset_input_create_or_fail returned zero (harfbuzz failed to initialize)");
  }

  const fontPointer = hb.malloc(fontBytes.byteLength);
  heap().set(fontBytes, fontPointer);

  const blob = hb.hb_blob_create(fontPointer, fontBytes.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);

  let subset = 0;
  try {
    const layoutFeatures = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    hb.hb_set_clear(layoutFeatures);
    hb.hb_set_invert(layoutFeatures);

    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const character of keepText) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined) hb.hb_set_add(unicodes, codePoint);
    }

    subset = hb.hb_subset_or_fail(face, input);
    if (subset === 0) {
      throw new Error("hb_subset_or_fail returned zero (the font may be corrupt or unsupported)");
    }
  } finally {
    hb.hb_subset_input_destroy(input);
  }

  const resultBlob = hb.hb_face_reference_blob(subset);
  try {
    const offset = hb.hb_blob_get_data(resultBlob, 0);
    const length = hb.hb_blob_get_length(resultBlob);
    if (length === 0) throw new Error("harfbuzz produced an empty subset font");
    // Copy out of the wasm heap before anything can grow or free it.
    return new Uint8Array(heap().subarray(offset, offset + length));
  } finally {
    hb.hb_blob_destroy(resultBlob);
    hb.hb_face_destroy(subset);
    hb.hb_face_destroy(face);
    hb.free(fontPointer);
  }
}
