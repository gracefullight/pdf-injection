import type { CanvasContext2DLike, CanvasFactory } from "./canvas-surface";
import { CanvasUnavailableError } from "./errors";
import {
  type InjectImageOnlyInput,
  type InjectImageOnlyResult,
  injectImageOnlyWith,
} from "./inject-image-only";

/**
 * Narrows a DOM 2D context to `CanvasContext2DLike`. A direct structural match
 * is impossible: the DOM types `fillStyle` as
 * `string | CanvasGradient | CanvasPattern` and `textBaseline` as a string
 * union, while the rasterizer only ever assigns plain strings. This adapter
 * keeps that assignment type-safe instead of casting the whole context.
 */
function adaptContext(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): CanvasContext2DLike {
  return {
    get font() {
      return ctx.font;
    },
    set font(value: string) {
      ctx.font = value;
    },
    get fillStyle() {
      return typeof ctx.fillStyle === "string" ? ctx.fillStyle : "";
    },
    set fillStyle(value: string) {
      ctx.fillStyle = value;
    },
    get textBaseline() {
      return ctx.textBaseline;
    },
    set textBaseline(value: string) {
      ctx.textBaseline = value as CanvasTextBaseline;
    },
    fillText: (text, x, y) => ctx.fillText(text, x, y),
    measureText: (text) => ctx.measureText(text),
  };
}

/**
 * `CanvasFactory` backed by the browser's own canvas — `image_only` needs no
 * native module here, since rasterizing text is what a browser does natively.
 *
 * Prefers `OffscreenCanvas` (no DOM node, works off the main thread) and falls
 * back to a detached `<canvas>` element for older engines. PNG encoding is
 * asynchronous in both, which is why `CanvasSurface.encodePng()` is a promise.
 */
export const browserCanvasFactory: CanvasFactory = async (width, height) => {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context)
      throw new CanvasUnavailableError("Could not acquire a 2D OffscreenCanvas context");
    return {
      context: adaptContext(context),
      encodePng: async () => {
        const blob = await canvas.convertToBlob({ type: "image/png" });
        return new Uint8Array(await blob.arrayBuffer());
      },
    };
  }

  if (typeof document === "undefined") {
    throw new CanvasUnavailableError(
      "image_only injection needs a canvas: this runtime has neither OffscreenCanvas nor a DOM",
    );
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new CanvasUnavailableError("Could not acquire a 2D canvas context");
  return {
    context: adaptContext(context),
    encodePng: () =>
      new Promise<Uint8Array>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new CanvasUnavailableError("Canvas PNG encoding returned no data"));
            return;
          }
          blob
            .arrayBuffer()
            .then((buffer) => resolve(new Uint8Array(buffer)))
            .catch(reject);
        }, "image/png");
      }),
  };
};

/** `image_only` in the browser: the shared rasterizer bound to a DOM/Offscreen canvas. */
export async function injectImageOnlyInBrowser(
  input: InjectImageOnlyInput,
): Promise<InjectImageOnlyResult> {
  return injectImageOnlyWith(browserCanvasFactory, input);
}
