// Production static file server for apps/web's Vite build output.
//
// Docker-only tooling: used by the second stage of ../Dockerfile after
// `vite build` has produced ./dist. NOT part of local dev (`bun run dev`
// still uses Vite's own dev server + /api proxy, see vite.config.ts) and
// not included in apps/web/tsconfig.json's `include` (kept out of the
// frontend's typecheck target on purpose, since this never runs in the
// browser and has no React/DOM dependency) — typechecked informally here
// via `bunx tsc --noEmit --skipLibCheck --types bun-types serve.ts` and
// exercised at runtime by serve.test.ts (`bun test` picks it up like any
// other `*.test.ts` file — no separate wiring needed).
//
// Responsibilities:
//   1. Serve static files from ./dist.
//   2. SPA fallback: any request that doesn't match a real file under
//      ./dist and isn't under /api falls back to index.html, so
//      client-side routes (e.g. deep links) still load the app shell.
//   3. Proxy /api/* to the API container so the browser only ever talks to
//      this single origin (mirrors vite.config.ts's dev-server proxy).
//
// Hardening (see .agents/state/memories/result-qa-r1b-session-20260822-132343.md
// HIGH finding — a malformed path segment, e.g. `%2f`-encoded, made
// `new URL(relative, DIST_DIR)` throw `ERR_INVALID_FILE_URL_PATH`, and the
// uncaught error reached Bun's default *development* error page — which
// discloses this file's absolute path, source, and a stack trace to an
// unauthenticated client — because the image never set NODE_ENV=production):
//   - `development: false` is passed explicitly to `Bun.serve()` so this
//     never depends solely on NODE_ENV being set correctly by the Dockerfile
//     (which now also sets it, defense in depth — see ../Dockerfile).
//   - Every file-lookup path is wrapped in try/catch; any failure to
//     resolve/read a path (malformed URL, ENOENT, etc.) falls through to
//     the SPA-fallback/404 path, never to a thrown exception.
//   - `error()` is set as a final backstop returning a generic, static 500
//     body, so even an unanticipated exception (e.g. in the /api proxy)
//     can never render Bun's error overlay.
//   - `resolveDistFile()` re-checks that the resolved URL's pathname still
//     starts with `dist/`'s own pathname before it's used, rejecting
//     anything that would otherwise resolve outside of it. (WHATWG URL
//     parsing already normalizes `..`/`%2e%2e` segments before `pathname`
//     is read, so this couldn't be bypassed in testing — this check is
//     defense in depth, not the only line of defense.)

export interface ServeConfig {
  /** Directory to serve static files from. Defaults to ./dist next to this file. */
  distDir?: URL;
  /** Port to listen on. Defaults to $PORT or 80. Pass 0 for an OS-assigned ephemeral port (tests). */
  port?: number;
  /** Target origin for /api/* requests. Defaults to $PS_API_PROXY_TARGET or http://api:3001. */
  apiProxyTarget?: string;
}

const DEFAULT_DIST_DIR = new URL("./dist/", import.meta.url);
const DEFAULT_PORT = Number(process.env.PORT ?? 80);
const DEFAULT_API_PROXY_TARGET = process.env.PS_API_PROXY_TARGET ?? "http://api:3001";

/**
 * Resolves `relative` against `distDir`, returning null (instead of
 * throwing) for anything malformed or that would resolve outside distDir.
 */
function resolveDistFile(relative: string, distDir: URL): URL | null {
  try {
    const candidate = new URL(relative, distDir);
    if (!candidate.pathname.startsWith(distDir.pathname)) return null;
    return candidate;
  } catch {
    return null;
  }
}

async function serveStatic(pathname: string, distDir: URL): Promise<Response> {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");

  try {
    const candidate = resolveDistFile(relative, distDir);
    if (candidate) {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        return new Response(file);
      }
    }
  } catch {
    // Fall through to the SPA fallback below.
  }

  try {
    const indexFile = Bun.file(new URL("index.html", distDir));
    if (await indexFile.exists()) {
      return new Response(indexFile, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  } catch {
    // Fall through to the plain 404 below.
  }

  return new Response("Not Found", { status: 404 });
}

async function proxyApi(
  req: Request,
  pathname: string,
  search: string,
  apiProxyTarget: string,
): Promise<Response> {
  const target = new URL(pathname + search, apiProxyTarget);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  const proxied = await fetch(target, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? req.body : undefined,
    // Required by the fetch spec when streaming a request body in Bun/undici.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);

  return proxied;
}

/** Builds (and starts) the server. Exported so serve.test.ts can start it on an ephemeral port. */
export function createServer(config: ServeConfig = {}) {
  const distDir = config.distDir ?? DEFAULT_DIST_DIR;
  const apiProxyTarget = config.apiProxyTarget ?? DEFAULT_API_PROXY_TARGET;
  const port = config.port ?? DEFAULT_PORT;

  return Bun.serve({
    port,
    // Never render Bun's development error overlay (source/paths/stack) to
    // a client, regardless of NODE_ENV. See the module-level comment above.
    development: false,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith("/api")) {
        return proxyApi(req, url.pathname, url.search, apiProxyTarget);
      }

      return serveStatic(url.pathname, distDir);
    },
    error() {
      return new Response("Internal Server Error", { status: 500 });
    },
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(
    `apps/web static server listening on :${server.port} (API proxy target: ${DEFAULT_API_PROXY_TARGET})`,
  );
}
