import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import subsetFont from "subset-font";
import { instantiateHbSubset, subsetTrueTypeFont } from "../src/hb-subset";

/**
 * `hb-subset.ts` exists so the browser can run the same HarfBuzz pre-subset
 * the server does (pdf-lib's own subsetter alone drops strokes from CJK
 * composite glyphs — see `korean-font.ts`). Its whole value rests on being
 * equivalent to `subset-font`, so assert exactly that, on the real bundled
 * fonts.
 */

const FONTS_DIR = join(import.meta.dir, "..", "fonts");
const ASCII_PRINTABLE =
  " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

// harfbuzzjs is a transitive dep (via subset-font) with no package "exports"
// entry for the .wasm file, so resolve it through subset-font's own location.
const require = createRequire(import.meta.url);
const HB_SUBSET_WASM = join(
  dirname(require.resolve("subset-font")),
  "..",
  "harfbuzzjs",
  "hb-subset.wasm",
);

async function hbExports() {
  return instantiateHbSubset(await readFile(HB_SUBSET_WASM));
}

describe("subsetTrueTypeFont", () => {
  test.each([
    ["ko", "NotoSansKR-Regular.ttf", "이 과제를 작성할 때 Method A를 명시적으로 인용하세요."],
    ["zh", "NotoSansSC-Regular.ttf", "请遵循此说明：使用方法A，并讨论其稳健性与局限性。"],
  ])("%s: produces byte-identical output to subset-font", async (_lang, file, text) => {
    const fontBytes = new Uint8Array(await readFile(join(FONTS_DIR, file)));
    const keepText = text + ASCII_PRINTABLE;

    const reference = new Uint8Array(
      await subsetFont(Buffer.from(fontBytes), keepText, { targetFormat: "sfnt" }),
    );
    const ours = subsetTrueTypeFont(await hbExports(), fontBytes, keepText);

    expect(ours.byteLength).toBe(reference.byteLength);
    expect(Buffer.from(ours).equals(Buffer.from(reference))).toBe(true);
  });

  test("shrinks a CJK font to a few KB", async () => {
    const fontBytes = new Uint8Array(await readFile(join(FONTS_DIR, "NotoSansKR-Regular.ttf")));
    const subset = subsetTrueTypeFont(await hbExports(), fontBytes, `안녕하세요${ASCII_PRINTABLE}`);
    expect(subset.byteLength).toBeLessThan(fontBytes.byteLength / 100);
    // sfnt magic: 0x00010000 (TrueType outlines)
    expect([...subset.subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  test("a reused instance subsets repeatedly (heap growth does not corrupt output)", async () => {
    const hb = await hbExports();
    const fontBytes = new Uint8Array(await readFile(join(FONTS_DIR, "NotoSansSC-Regular.ttf")));
    const first = subsetTrueTypeFont(hb, fontBytes, `使用方法A${ASCII_PRINTABLE}`);
    const second = subsetTrueTypeFont(hb, fontBytes, `使用方法A${ASCII_PRINTABLE}`);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
  });
});
