import { ApiError } from "../errors";

/**
 * Reads a request body while streaming, aborting with FILE_TOO_LARGE the
 * moment the accumulated size exceeds `maxBytes`. Mirrors
 * routes/jobs.ts's `readBodyWithLimit` (kept here as a shared helper for
 * the round-2 §1/§3 multipart routes so it isn't duplicated three times).
 */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError("FILE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Parses a size-limited multipart/form-data request body into a FormData. */
export async function readFormData(request: Request, maxBytes: number): Promise<FormData> {
  const bodyBytes = await readBodyWithLimit(request, maxBytes);
  const reconstructed = new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: bodyBytes as BodyInit,
  });
  try {
    return await reconstructed.formData();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body is not valid multipart/form-data");
  }
}

export function strField(formData: FormData, name: string): string | null {
  const v = formData.get(name);
  return typeof v === "string" ? v : null;
}
