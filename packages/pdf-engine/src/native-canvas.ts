// Resolves the @napi-rs/canvas native module through pdfjs-dist's own
// module-resolution root, instead of importing @napi-rs/canvas directly
// from this package.
//
// WHY: pdfjs-dist declares an `optionalDependencies` range on
// `@napi-rs/canvas` that it uses internally (its `NodeCanvasFactory`, and to
// polyfill `globalThis.Path2D`/`DOMMatrix`/`ImageData`). If this package
// also declared its own (newer, disjoint-range) dependency on
// `@napi-rs/canvas`, a workspace package manager that doesn't dedupe across
// disjoint semver ranges (bun does not, for good reason) would install TWO
// separate copies of the native addon, which fail in confusing ways when
// objects created from one copy are passed to APIs from the other — see
// `.agents/state/memories/result-backend-r4-session-20260822-132343.md`
// (packages/robustness's own `native-canvas.ts`, which this module mirrors)
// for the full investigation. Always resolving through the SAME require
// root pdfjs-dist itself uses guarantees identity match regardless of
// whatever version bun's lockfile happens to pick, without this package
// declaring a top-level `@napi-rs/canvas` dependency at all.
import { createRequire } from "node:module";
import type { CanvasFactory } from "./canvas-surface";
import { CanvasUnavailableError } from "./errors";

export interface NapiTextMetrics {
  readonly width: number;
}

export interface NapiImageData {
  readonly data: Uint8ClampedArray;
}

/**
 * The subset of @napi-rs/canvas's CanvasRenderingContext2D this package
 * draws with (`inject-image-only.ts`) and reads back pixels with (test-only
 * pixel-diff verification for freetext_annot/acroform_field's "nothing is
 * painted" claim — see `packages/pdf-engine/test/inject-freetext-annot.test.ts`).
 */
export interface NapiCanvasContext2D {
  font: string;
  fillStyle: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): NapiTextMetrics;
  getImageData(sx: number, sy: number, sw: number, sh: number): NapiImageData;
}

export interface NapiCanvas {
  readonly width: number;
  readonly height: number;
  getContext(kind: "2d"): NapiCanvasContext2D;
  toBuffer(mimeType: "image/png"): Buffer;
}

export interface NapiCanvasModule {
  createCanvas(width: number, height: number): NapiCanvas;
}

let cached: { module: NapiCanvasModule | null; reason: string | null } | null = null;

/**
 * Lazily resolves the @napi-rs/canvas module instance that pdfjs-dist's own
 * legacy/build/pdf.mjs resolves internally. Returns `{ module: null, reason }`
 * (never throws) when the native addon cannot be loaded (e.g. missing
 * platform binary, sandboxed environment without native addon support).
 */
export async function resolveNapiCanvas(): Promise<{
  module: NapiCanvasModule | null;
  reason: string | null;
}> {
  if (cached) return cached;
  try {
    const pdfjsPkgUrl = import.meta.resolve("pdfjs-dist/package.json");
    const req = createRequire(pdfjsPkgUrl);
    const mod = req("@napi-rs/canvas") as NapiCanvasModule;
    if (typeof mod.createCanvas !== "function") {
      cached = {
        module: null,
        reason: "@napi-rs/canvas module loaded but createCanvas is not a function",
      };
      return cached;
    }
    cached = { module: mod, reason: null };
    return cached;
  } catch (err) {
    cached = {
      module: null,
      reason: `@napi-rs/canvas native module unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
    return cached;
  }
}

/**
 * Resolves pdfjs-dist's bundled `standard_fonts/` directory as a filesystem
 * path with a trailing slash, for pdfjs's `standardFontDataUrl` render
 * option. Required for `page.render()` on pages using non-embedded standard
 * fonts — without it, pdfjs throws deep inside the glyph-path executor (see
 * `.agents/state/memories/result-backend-r4-session-20260822-132343.md`,
 * finding #1). Test-only in this package (pdf-engine's own src/ never
 * rasterizes a full page — only `packages/pdf-engine/test/`'s pixel-diff
 * assertions for freetext_annot/acroform_field do).
 */
export function resolveStandardFontDataUrl(): string {
  const pdfjsPkgUrl = import.meta.resolve("pdfjs-dist/package.json");
  const pkgPath = new URL(pdfjsPkgUrl);
  const dir = pkgPath.pathname.replace(/\/package\.json$/, "");
  return `${dir}/standard_fonts/`;
}

/** Test-only: clears the module-level cache so a fresh resolution is attempted. */
export function __resetNapiCanvasCacheForTests(): void {
  cached = null;
}

/**
 * `CanvasFactory` backed by `@napi-rs/canvas` — the Node/Bun platform's
 * rasterizer for `image_only`. Kept here (rather than in
 * `inject-image-only.ts`) so the injector itself stays runtime-agnostic and
 * the browser entry never reaches this module — see `canvas-surface.ts`.
 */
export const napiCanvasFactory: CanvasFactory = async (width, height) => {
  const { module: canvasModule, reason } = await resolveNapiCanvas();
  if (!canvasModule) {
    throw new CanvasUnavailableError(
      `image_only injection requires @napi-rs/canvas: ${reason ?? "unavailable"}`,
    );
  }
  const canvas = canvasModule.createCanvas(width, height);
  return {
    context: canvas.getContext("2d"),
    encodePng: async () => new Uint8Array(canvas.toBuffer("image/png")),
  };
};
