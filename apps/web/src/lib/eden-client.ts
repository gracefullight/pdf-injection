import { treaty } from "@elysiajs/eden";
import type { App } from "@pdf-injection/api";
import type { ApiError } from "@pdf-injection/contracts";

/**
 * Shared Eden Treaty client + domain-resolution/error-unwrap helpers.
 *
 * Factored out of `api.ts` (round 1) so the round-2 modules
 * (`api-model-tests.ts`, `api-robustness.ts`, `api-variant-sets.ts`,
 * `api-submissions.ts`) can call through Eden Treaty too, now that their
 * routes are registered on the Elysia `App` type. `api.ts` re-exports those
 * four modules via `export *` — importing `eden` back from `api.ts` inside
 * any of them would create a compile-time module cycle
 * (api.ts -> api-model-tests.ts -> api.ts), so this file is the shared leaf
 * every module (including `api.ts` itself) imports from instead.
 */
export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const API_PREFIX = `${BASE_URL.replace(/\/$/, "")}/v1`;

// Eden route paths are the literal strings registered in apps/api (e.g.
// "/api/v1/jobs", already including the "/api/v1" prefix) — the `domain`
// passed to `treaty()` must therefore be the bare origin, not the "/api" base
// path, or requests would end up double-prefixed ("/api/api/v1/..."). Eden
// Treaty (v2, `@elysiajs/eden`'s `treaty()`) always builds an absolute URL
// from `domain` — passing `""` does NOT fall back to a page-relative request
// the way plain `fetch("/api/...")` does; empirically it produces a broken
// URL like `https://api/v1/jobs` (the route path's own leading segment gets
// parsed as the hostname). So the domain must always be a real origin: when
// `VITE_API_BASE_URL` is left at its default ("/api", not absolute), use
// `window.location.origin` — Vite's dev-server proxy still forwards
// `/api/*` on that same origin to `apps/api`, identical to plain fetch's
// prior behavior. When `VITE_API_BASE_URL` is set to an absolute URL (e.g.
// for a test harness hitting the API directly without the proxy), any
// trailing "/api" suffix is stripped so the domain is just the origin.
/**
 * Pure resolution logic (no `window`/`import.meta.env` reads) so it's
 * unit-testable in isolation — see `api.test.ts`.
 */
export function resolveEdenDomain(baseUrl: string, pageOrigin: string | undefined): string {
  if (/^https?:\/\//.test(baseUrl)) {
    return baseUrl.replace(/\/api\/?$/, "");
  }
  return pageOrigin ?? "http://localhost:5173";
}

const EDEN_DOMAIN = resolveEdenDomain(
  BASE_URL,
  typeof window !== "undefined" ? window.location.origin : undefined,
);

export const eden = treaty<App>(EDEN_DOMAIN);

export function authHeaders(accessToken: string): HeadersInit {
  return { "X-Job-Token": accessToken };
}

/**
 * Narrows an Eden Treaty `{data, error}` result into `T`, throwing an
 * instance of the caller-supplied error class on failure. Each API module
 * keeps its own error class (`ApiRequestError`, `ModelTestsApiError`,
 * `RobustnessApiError`, `ResearchApiError`) so `instanceof` checks by
 * feature/domain keep working exactly as before the Eden switch — this
 * helper only centralizes the Eden envelope-unwrapping logic, not the error
 * type itself.
 */
/**
 * A transport-level failure (server unreachable, DNS failure, offline) — Eden Treaty catches the
 * underlying `fetch()` rejection internally and returns it via `result.error` rather than
 * rejecting its own promise, so it never has the `{value: {error: {code, message}}}` shape a
 * real API error response does. Distinguishing this case fixes M-04 (r11 review): before this,
 * every transport failure fell into the generic `VALIDATION_ERROR` fallback below and was shown
 * as "The request contains invalid or missing fields" — the wrong cause. (The UI renders only
 * the `en` text of `ERROR_MESSAGES`; the `ko` field exists in the map but is not shown.)
 */
function isTransportFailure(errorValue: unknown): boolean {
  if (errorValue instanceof TypeError) return true;
  if (errorValue instanceof Error && /fetch|network|failed to fetch/i.test(errorValue.message))
    return true;
  return false;
}

/**
 * Client-only synthetic error for "the server answered, but not with this API's error envelope"
 * — e.g. a static host (GitHub Pages) returning 404/405 HTML because no API backend is deployed
 * behind `VITE_API_BASE_URL`, or a gateway 502. Before this, such responses fell into the
 * generic `VALIDATION_ERROR` fallback and rendered as "The request contains invalid or missing
 * fields", which blamed the user's input for a deployment problem. Like `NETWORK_ERROR`, the code
 * is deliberately not part of the shared `ApiErrorCode` union (the server never emits it), so
 * `ERROR_MESSAGES[code]` misses and `error.message` is what renders.
 */
export function apiUnavailableError(status: number): ApiError["error"] {
  return {
    code: "API_UNAVAILABLE",
    message: `The API server did not respond as expected (HTTP ${status || "error"}). This site may not have an API backend configured — check the API deployment / VITE_API_BASE_URL.`,
  } as unknown as ApiError["error"];
}

export function unwrapEdenAs<T, E extends Error>(
  result: { data: unknown; error: unknown; status: number },
  ErrorClass: new (status: number, error: ApiError["error"]) => E,
): T {
  if (result.error !== null && result.error !== undefined) {
    const errorValue = (result.error as { value?: unknown })?.value ?? result.error;
    const errorPayload =
      errorValue &&
      typeof errorValue === "object" &&
      "error" in (errorValue as Record<string, unknown>)
        ? (errorValue as ApiError).error
        : isTransportFailure(errorValue)
          ? // Cast: "NETWORK_ERROR" is a client-only synthetic code, deliberately not added to
            // the shared `ApiErrorCode` union (the server never emits it) — every call site's
            // `ERROR_MESSAGES[code]` lookup already falls back to `error.message` for unknown
            // codes, so this message (not `ERROR_MESSAGES`) is what actually renders.
            ({
              code: "NETWORK_ERROR",
              message: "Could not reach the server. Check that the API is running and try again.",
            } as unknown as ApiError["error"])
          : apiUnavailableError(result.status);
    throw new ErrorClass(result.status, errorPayload);
  }
  return result.data as T;
}

/**
 * Extracts a header value from an Eden Treaty result's `headers` (typed
 * loosely as `ResponseInit['headers']` by Eden; observed as a plain
 * lower-cased `Record<string, string>` at runtime for every route in this
 * API, since none of them stream a custom `Headers` instance back through
 * Elysia's `set.headers`-less raw `Response` path for JSON bodies).
 */
export function edenHeader(headers: unknown, name: string): string | null {
  if (
    headers &&
    typeof headers === "object" &&
    !Array.isArray(headers) &&
    !(headers instanceof Headers)
  ) {
    const value = (headers as Record<string, string>)[name];
    return typeof value === "string" ? value : null;
  }
  if (headers instanceof Headers) return headers.get(name);
  return null;
}

/**
 * Shared error-payload reader for the raw-`fetch` (binary/multipart/CSV/ZIP) call sites across
 * `api.ts` / `research-fetch.ts` / `api-model-tests.ts` / `api-robustness.ts` /
 * `api-submissions.ts` — an identical ~8-line copy of this function used to live in each of
 * those files (r11 DX review L1). `eden-client.ts` is already the shared acyclic leaf every one
 * of them imports `authHeaders`/`unwrapEdenAs` from, so centralizing this here doesn't introduce
 * the `api.ts` <-> `api-*.ts` import cycle those modules' doc comments warn about (that cycle is
 * specifically about importing back from `api.ts`, not from this leaf file).
 */
export async function readErrorPayload(response: Response): Promise<ApiError["error"]> {
  let body: ApiError | null = null;
  try {
    body = (await response.json()) as ApiError;
  } catch {
    // response had no JSON body; synthesize a generic error below
  }
  return body?.error ?? apiUnavailableError(response.status);
}
