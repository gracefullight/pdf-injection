/**
 * The tiny 2D-canvas surface `inject-image-only.ts` needs, abstracted so the
 * rasterizer can run on either runtime's canvas.
 *
 * `@napi-rs/canvas` (Node) and the DOM's `HTMLCanvasElement` /
 * `OffscreenCanvas` (browser) expose the same drawing API, and differ only in
 * how a canvas is created and how it is encoded to PNG (Node returns a Buffer
 * synchronously; the browser encodes asynchronously through `toBlob` /
 * `convertToBlob`). Modelling exactly that difference — and nothing else —
 * lets `image_only` share one implementation across both platforms.
 *
 * Node-free by construction: this module imports nothing, so it is safe for
 * the browser entry (see `test/browser-entry-purity.test.ts`).
 */

export interface CanvasTextMetricsLike {
  readonly width: number;
}

/** The drawing/measuring surface the rasterizer uses. */
export interface CanvasContext2DLike {
  font: string;
  fillStyle: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): CanvasTextMetricsLike;
}

/** One canvas plus the runtime's way of encoding it to PNG bytes. */
export interface CanvasSurface {
  readonly context: CanvasContext2DLike;
  encodePng(): Promise<Uint8Array>;
}

/**
 * Creates a canvas of the given pixel size. Throws (typically
 * `CanvasUnavailableError`) when the runtime cannot rasterize at all.
 */
export type CanvasFactory = (width: number, height: number) => Promise<CanvasSurface>;
