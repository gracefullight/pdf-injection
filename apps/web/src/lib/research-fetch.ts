import type { ApiError } from "@pdf-injection/contracts";
import { parseContentDispositionFilename } from "@/lib/content-disposition";
import { API_PREFIX, authHeaders, readErrorPayload } from "@/lib/eden-client";

/**
 * Shared typed-`fetch` helper for round-2 "research mode" API modules
 * (`api-variant-sets.ts`, `api-submissions.ts`) whose `apps/api` routes are
 * landing concurrently (r5b) and are therefore not yet on the Eden `App`
 * type `lib/api.ts` is built against. Mirrors the same pattern r6 already
 * established in `api-model-tests.ts` / `api-robustness.ts` for the same
 * reason.
 *
 * Deliberately does NOT import from `./api` (`throwFetchError`/`ApiRequestError`
 * are exported there too) — `api.ts` re-exports `api-variant-sets.ts` and
 * `api-submissions.ts` via `export *`, so importing back from `api.ts` here
 * would create a compile-time module cycle (api.ts -> api-variant-sets.ts ->
 * api.ts). `API_PREFIX`/`authHeaders`/`readErrorPayload` are safe to import
 * from `eden-client.ts` though — it's the shared acyclic leaf every one of
 * these modules already imports from for `eden`/`unwrapEdenAs` (r11 DX
 * review L1: these three used to be redeclared here verbatim).
 */
export { API_PREFIX, authHeaders };

export class ResearchApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(status: number, error: ApiError["error"]) {
    super(error.message);
    this.name = "ResearchApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export async function throwFetchError(response: Response): Promise<never> {
  throw new ResearchApiError(response.status, await readErrorPayload(response));
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) await throwFetchError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function deleteRequest(url: string, accessToken: string): Promise<void> {
  const response = await fetch(url, { method: "DELETE", headers: authHeaders(accessToken) });
  if (response.status !== 204 && !response.ok) await throwFetchError(response);
}

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export async function downloadFile(
  url: string,
  accessToken: string,
  fallbackFilename: string,
): Promise<DownloadedFile> {
  const response = await fetch(url, { headers: authHeaders(accessToken) });
  if (!response.ok) await throwFetchError(response);
  const blob = await response.blob();
  const filename = parseContentDispositionFilename(
    response.headers.get("Content-Disposition"),
    fallbackFilename,
  );
  return { blob, filename };
}

/** Builds a multipart FormData body, skipping `undefined` fields. */
export function toFormData(fields: Record<string, string | File | undefined>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    formData.append(key, value);
  }
  return formData;
}
