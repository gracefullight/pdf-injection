// Round-2 §1 archive downloads (variant-set / student-keyed-set zips) via
// fflate (MIT). Synchronous zipSync is fine here: archive contents are a
// handful of already-in-memory PDFs + one manifest JSON file, well under
// any size that would justify the async/streaming API.
import { strToU8, zipSync } from "fflate";

export interface ZipEntry {
  /** Path inside the archive (no leading slash). */
  path: string;
  data: Uint8Array;
}

/**
 * Defense-in-depth Zip-Slip (CWE-22) guard: every entry name in this
 * package's archives is meant to be a single flat filename at the archive
 * root (never a subdirectory), so a path separator or `..` segment can only
 * mean an unsanitized user-supplied value (e.g. a variant label / student
 * id) leaked into a zip entry path. Callers are expected to sanitize
 * user-supplied segments before building a `ZipEntry.path` (see
 * `sanitizeArchiveSegment` usage in variant-set.service.ts /
 * student-keyed-set.service.ts) — this is the last line of defense, not the
 * primary one.
 */
function assertSafeZipEntryPath(path: string): void {
  // A path separator is the only thing that can turn a zip entry name into
  // a multi-segment path a (naive/older) extractor might honor; a bare ".."
  // with no separator (e.g. inside "stem...injected.pdf") is just an
  // ordinary filename with dots in it, not a traversal vector, so it's
  // deliberately not rejected here (rejecting it would also incorrectly
  // reject legitimate dotfile-derived source-filename stems).
  if (path.includes("/") || path.includes("\\")) {
    throw new Error(`Unsafe zip entry path (contains a path separator): ${JSON.stringify(path)}`);
  }
}

/** Builds a zip archive (as bytes) from a flat list of entries. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    assertSafeZipEntryPath(entry.path);
    files[entry.path] = entry.data;
  }
  return zipSync(files, { level: 6 });
}

/** Convenience: encodes a JSON-serializable value as a zip entry's bytes. */
export function jsonZipEntry(path: string, value: unknown): ZipEntry {
  return { path, data: strToU8(JSON.stringify(value, null, 2)) };
}
