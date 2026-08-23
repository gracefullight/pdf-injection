import type { Position } from "@pdf-injection/contracts";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream } from "pdf-lib";
import { CanvasUnavailableError, InjectionFailedError, PdfEngineError } from "./errors";
import type { InjectTextResult } from "./inject-white-text";
import { type NapiCanvasContext2D, resolveNapiCanvas } from "./native-canvas";
import { DEFAULT_MARGIN_X, resolveBoxPosition } from "./text-layout";

/** Default rasterized font size (pt) — small and unobtrusive, still legible to OCR/vision. */
export const IMAGE_ONLY_DEFAULT_FONT_SIZE = 8;
/** Raster pixels per PDF point — keeps small text crisp without an oversized PNG. */
const RASTER_SCALE = 4;
const LINE_HEIGHT_RATIO = 1.2;
/** Grey, semi-opaque — deliberately visible (it's a diagnostic, not a hidden channel) but unobtrusive. */
const FILL_STYLE = "rgba(110, 110, 110, 0.9)";

/** Custom key tagging the stamped image XObject with the prompt hash, for round-trip verification independent of pixel content. */
export const IMAGE_ONLY_PROMPT_SHA256_KEY = "PdfiPromptSha256";

export interface InjectImageOnlyInput {
  doc: PDFDocument;
  pageIndex: number;
  instruction: string;
  promptSha256: string;
  position: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
}

export interface InjectImageOnlyResult extends InjectTextResult {
  /**
   * The reloaded PDFDocument instance carrying the tagged image XObject.
   * `inject.ts`'s dispatcher must swap its local `doc` variable to this
   * BEFORE its own final `doc.save()` / reload / geometry-check step — same
   * contract as `InjectUnicodeTagsResult.doc`.
   */
  doc: PDFDocument;
}

/**
 * Greedy word-wrap using canvas `measureText`, mirroring
 * `text-layout.ts`'s `wrapTextToLines` algorithm but against the canvas 2D
 * measurement API instead of a pdf-lib `PDFFont` (the two aren't
 * interchangeable, hence the separate implementation here rather than
 * reusing `wrapTextToLines` directly).
 */
function wrapTextForCanvas(text: string, ctx: NapiCanvasContext2D, maxWidthPx: number): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/).filter((w) => w.length > 0);
    let current = "";

    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (current.length === 0 || ctx.measureText(candidate).width <= maxWidthPx) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  return lines;
}

/**
 * IMAGE-01 (image_only) — round-3 research/diagnostic condition:
 * rasterizes the instruction to a PNG and stamps it on the target page via
 * `embedPng` + `drawImage`. **No text object of any kind is written** —
 * unlike every other injection mode. That is the whole point of this
 * condition: it answers "does the provider's ingestion pipeline have a
 * vision path at all?" A text-only extraction pipeline can never surface
 * this payload, by construction (verified by
 * `packages/pdf-engine/test/inject-image-only.test.ts`'s dedicated "no
 * text object" assertion — unlike every hidden-text mode, whose
 * extractability is uncertain and IS the thing being measured, this mode's
 * non-extractability via text is a structural guarantee, not an empirical
 * finding).
 *
 * Drawn small and grey (`rgba(110,110,110,0.9)`) in the bottom margin,
 * against a transparent PNG background (no filled rectangle) — legible to
 * OCR/vision but visually unobtrusive. It is deliberately visible (like
 * `visible_positive_control`), so `diffThreshold("image_only")` is
 * `Infinity` (contracts `overall.ts`) rather than the near-zero tier the
 * other three round-3 probe modes use.
 *
 * Resolves `@napi-rs/canvas` the same way `native-canvas.ts` does (through
 * pdfjs-dist's own require root) — see that file's module doc for why a
 * top-level `@napi-rs/canvas` dependency is deliberately NOT added. Throws
 * `CanvasUnavailableError` (ApiErrorCode `CANVAS_UNAVAILABLE`) rather than
 * silently producing a text-free no-op when the native module can't load.
 *
 * Performs the same "intermediate save -> reload -> public-API dict
 * mutation" cycle `injectUnicodeTags` uses: `embedPng`/`drawImage`'s image
 * XObject is lazily materialized by pdf-lib and only has a real dict after
 * a save/reload round-trip, so the custom `PdfiPromptSha256` marker (read
 * back by `readStampedImagePresence`, independent of any pixel content) is
 * written onto the RELOADED image XObject's dict in place, via public
 * `PDFDict`/`PDFName` APIs — no new stream needs registering, unlike
 * unicode_tags' ToUnicode CMap rewrite.
 */
export async function injectImageOnly(input: InjectImageOnlyInput): Promise<InjectImageOnlyResult> {
  const { module: canvasModule, reason } = await resolveNapiCanvas();
  if (!canvasModule) {
    throw new CanvasUnavailableError(
      `image_only injection requires @napi-rs/canvas: ${reason ?? "unavailable"}`,
    );
  }

  try {
    const { doc, pageIndex, instruction, promptSha256 } = input;
    const page = doc.getPage(pageIndex);
    const fontSize = input.fontSize ?? IMAGE_ONLY_DEFAULT_FONT_SIZE;
    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const boxWidth = input.maxWidth ?? page.getWidth() - 2 * DEFAULT_MARGIN_X;

    const scratchCtx = canvasModule.createCanvas(1, 1).getContext("2d");
    scratchCtx.font = `${fontSize * RASTER_SCALE}px sans-serif`;
    const lines = wrapTextForCanvas(instruction, scratchCtx, boxWidth * RASTER_SCALE);
    const boxHeight = Math.max(lines.length, 1) * lineHeight;

    const { x, y } = resolveBoxPosition({
      pageHeight: page.getHeight(),
      width: boxWidth,
      height: boxHeight,
      position: input.position,
      x: input.x,
      y: input.y,
    });

    const pxWidth = Math.max(1, Math.ceil(boxWidth * RASTER_SCALE));
    const pxHeight = Math.max(1, Math.ceil(boxHeight * RASTER_SCALE));
    const canvas = canvasModule.createCanvas(pxWidth, pxHeight);
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize * RASTER_SCALE}px sans-serif`;
    ctx.fillStyle = FILL_STYLE;
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, 0, i * lineHeight * RASTER_SCALE);
    });

    const pngBytes = canvas.toBuffer("image/png");
    const image = await doc.embedPng(pngBytes);
    page.drawImage(image, { x, y, width: boxWidth, height: boxHeight });

    // Materialize the lazily-embedded image XObject (see module doc), then
    // tag it via public PDFDict/PDFName APIs only.
    const intermediateBytes = await doc.save();
    const reloaded = await PDFDocument.load(intermediateBytes);
    const reloadedPage = reloaded.getPage(pageIndex);
    const resources = reloadedPage.node.Resources();
    if (!resources) {
      throw new InjectionFailedError(
        "image_only injection failed: reloaded page has no /Resources dict (expected the image XObject registered above)",
      );
    }

    const xObjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
    let tagged = false;
    if (xObjects) {
      for (const key of xObjects.keys()) {
        const xObject = xObjects.lookupMaybe(key, PDFStream);
        if (!xObject) continue;
        const subtype = xObject.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
        if (subtype === PDFName.of("Image")) {
          xObject.dict.set(
            PDFName.of(IMAGE_ONLY_PROMPT_SHA256_KEY),
            PDFHexString.fromText(promptSha256),
          );
          tagged = true;
        }
      }
    }
    if (!tagged) {
      throw new InjectionFailedError(
        "image_only injection failed: no Image XObject found on the target page after the intermediate save/reload",
      );
    }

    return {
      doc: reloaded,
      boundingBox: [x, y, x + boxWidth, y + boxHeight],
      fontSize,
    };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    throw new InjectionFailedError(`image_only injection failed: ${(err as Error).message}`);
  }
}

export interface StampedImagePresence {
  imagePresent: boolean;
  promptSha256: string | null;
}

/**
 * Reads back whether the target page carries an Image XObject tagged with
 * `IMAGE_ONLY_PROMPT_SHA256_KEY` by `injectImageOnly`, using only public
 * pdf-lib APIs — proves the payload is in the output independently of
 * pdfjs-dist (which never sees this at all, since pdfjs's `getTextContent()`
 * only ever inspects text objects).
 */
export async function readStampedImagePresence(
  bytes: Uint8Array,
  pageIndex: number,
): Promise<StampedImagePresence> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const resources = page.node.Resources();
  if (!resources) return { imagePresent: false, promptSha256: null };

  const xObjects = resources.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xObjects) return { imagePresent: false, promptSha256: null };

  let imagePresent = false;
  let promptSha256: string | null = null;
  for (const key of xObjects.keys()) {
    const xObject = xObjects.lookupMaybe(key, PDFStream);
    if (!xObject) continue;
    const subtype = xObject.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (subtype !== PDFName.of("Image")) continue;

    imagePresent = true;
    const tag = xObject.dict.lookupMaybe(PDFName.of(IMAGE_ONLY_PROMPT_SHA256_KEY), PDFHexString);
    if (tag) promptSha256 = tag.decodeText();
  }

  return { imagePresent, promptSha256 };
}
