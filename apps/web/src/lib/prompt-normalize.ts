/**
 * Mirrors `normalizePrompt` in `packages/pdf-engine/src/normalize-prompt.ts` so the
 * client-side hash preview (Instruction screen) matches the server-computed
 * `promptSha256` exactly. Steps: CRLF -> LF, trim trailing whitespace per line,
 * collapse 3+ blank lines to a single blank line, trim overall.
 */
export function normalizePrompt(instruction: string): string {
  const lfOnly = instruction.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmedLines = lfOnly
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  const collapsedBlankLines = trimmedLines.replace(/\n{3,}/g, "\n\n");
  return collapsedBlankLines.trim();
}

/** SHA-256 hex digest via the Web Crypto API (browser-native, no dependency). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Convenience: normalize then hash, matching the server's `promptSha256` derivation. */
export async function normalizedPromptHash(instruction: string): Promise<string> {
  return sha256Hex(normalizePrompt(instruction));
}
