// Resolves the @napi-rs/canvas native module through pdfjs-dist's own
// module-resolution root, instead of importing @napi-rs/canvas directly
// from this package.
//
// WHY: pdfjs-dist declares an `optionalDependencies` range on
// `@napi-rs/canvas` (currently `^0.1.65`) that it uses internally, both for
// its `NodeCanvasFactory` (`legacy/build/pdf.mjs`) and to polyfill
// `globalThis.Path2D`/`DOMMatrix`/`ImageData` from that same module. If this
// package also declares its own (newer, disjoint-range) dependency on
// `@napi-rs/canvas`, a workspace package manager that doesn't dedupe across
// disjoint semver ranges (bun does not, for good reason) installs TWO
// separate copies of the native addon. Passing a `Path2D`/`Canvas` created
// from one copy into a `CanvasRenderingContext2D` obtained from the other
// copy fails deep inside the napi binding with an opaque
// `InvalidArg: Value is none of these types \`String\`, \`Path\`` error,
// because the two copies have distinct native class identities even though
// they're "the same package". Confirmed via a spike prior to writing this
// module (see progress memory for backend-r4).
//
// Always resolving through the SAME require root pdfjs-dist itself uses
// guarantees identity match regardless of whatever version bun's lockfile
// happens to pick, without pinning this package to pdfjs-dist's internal
// (older) canvas version.
export interface NapiCanvasModule {
  createCanvas(width: number, height: number): NapiCanvas;
}

export interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
  toBuffer(mimeType: "image/png" | "image/jpeg"): Buffer;
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
    const nodeModuleBuiltin = (
      process as unknown as {
        getBuiltinModule(id: "module"): { createRequire(url: string): (id: string) => unknown };
      }
    ).getBuiltinModule("module");
    const req = nodeModuleBuiltin.createRequire(pdfjsPkgUrl);
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

/** Resolves pdfjs-dist's standard_fonts directory as a filesystem path with a trailing slash, for `standardFontDataUrl`. */
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
