/**
 * Runs `fn` once, and retries exactly once more when `isRetryable(err)` is
 * true (per contract §2: "1 retry on 429/5xx" for both anthropic and
 * openai adapters). Any error from the retry attempt propagates unchanged.
 */
export async function withRetryOnce<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isRetryable(err)) {
      return await fn();
    }
    throw err;
  }
}
