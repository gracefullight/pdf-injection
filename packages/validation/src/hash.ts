/**
 * SHA-256 hex digest via Bun.CryptoHasher (no external deps).
 * Used for sourceSha256 / outputSha256 / promptSha256 throughout the pipeline.
 */
export function sha256Hex(input: Uint8Array | string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(input);
  return hasher.digest("hex");
}
