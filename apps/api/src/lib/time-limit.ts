import { ApiError } from "../errors";

/**
 * Races `fn` against a wall-clock timer. If the timer wins, the returned
 * promise rejects with `ApiError("PROCESSING_TIMEOUT")` (contract §0.3:
 * `PDFI_MAX_PROCESSING_MS` -> 504, no row/files) — `fn` is NOT cancelled (JS
 * has no true cancellation for arbitrary async work), it simply keeps
 * running in the background and its eventual result is discarded by the
 * caller of `withTimeLimit` itself.
 *
 * Callers that persist side effects (file writes, DB inserts) from inside
 * `fn` MUST check `signal.aborted` after every await point that could have
 * taken a while, and skip further persistence once it's true — otherwise a
 * slow call that finishes just after the timeout fired could still write
 * files / insert a row for a request the client already saw fail with 504.
 * See `job.service.ts::createJob`'s use of this for the concrete pattern.
 */
export async function withTimeLimit<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError("PROCESSING_TIMEOUT"));
    }, ms);
    // Never let this timer keep the process (or a test runner) alive.
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
