/**
 * Parses a `Content-Disposition: attachment; filename="foo.pdf"` header value
 * (and the RFC 5987 `filename*=UTF-8''...` form) into a filename. Falls back
 * to the provided default when the header is missing or unparsable.
 */
export function parseContentDispositionFilename(
  headerValue: string | null,
  fallback: string,
): string {
  if (!headerValue) return fallback;

  const starMatch = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(headerValue);
  if (starMatch?.[1]) {
    try {
      return decodeURIComponent(starMatch[1].trim());
    } catch {
      // fall through to the plain filename form
    }
  }

  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(headerValue);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return fallback;
}
