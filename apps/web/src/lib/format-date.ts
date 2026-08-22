/**
 * Formats a timestamp for display, accepting either the ISO string the wire
 * contract types declare (`string`) or a `Date` instance — Eden Treaty
 * revives ISO date strings into real `Date` objects at runtime for fields
 * typed `string` in `@pdf-injection/contracts` (a known Eden Treaty behavior),
 * so any render site handling a server-provided timestamp must tolerate
 * both. Rendering a bare `Date` as a React child throws
 * ("Objects are not valid as a React child") and — without an error
 * boundary — used to blank the whole app (r11 review, finding C-01).
 */
export function formatDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
