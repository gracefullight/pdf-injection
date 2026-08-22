import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config";
import { jobDir } from "../storage";

/**
 * Generic (path-segment-based) artifact storage for round-2 background-run
 * outputs that don't fit `storage.ts`'s fixed `JobFileName` union (condition
 * PDFs keyed by mode, run results keyed by a generated `runId`, per-transform
 * robustness PDFs, ...). All paths are still confined to the job's own
 * directory (`jobDir()` already validates `jobId` is a well-formed UUID); each
 * individual path segment is additionally validated here so a `runId` or
 * mode string can never smuggle in `..`/`/` and escape the job directory.
 */
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function assertSafeSegment(segment: string): void {
  if (segment === "." || segment === ".." || !SAFE_SEGMENT_RE.test(segment)) {
    throw new Error(`Unsafe artifact path segment: ${JSON.stringify(segment)}`);
  }
}

export function jobArtifactPath(config: AppConfig, jobId: string, segments: string[]): string {
  for (const segment of segments) assertSafeSegment(segment);
  return join(jobDir(config, jobId), ...segments);
}

export async function writeJobArtifact(
  config: AppConfig,
  jobId: string,
  segments: string[],
  data: Uint8Array | string,
): Promise<void> {
  const path = jobArtifactPath(config, jobId, segments);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, data);
}

export async function readJobArtifactBytes(
  config: AppConfig,
  jobId: string,
  segments: string[],
): Promise<Uint8Array> {
  const path = jobArtifactPath(config, jobId, segments);
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}

export async function readJobArtifactText(
  config: AppConfig,
  jobId: string,
  segments: string[],
): Promise<string> {
  const path = jobArtifactPath(config, jobId, segments);
  return Bun.file(path).text();
}

export async function jobArtifactExists(
  config: AppConfig,
  jobId: string,
  segments: string[],
): Promise<boolean> {
  const path = jobArtifactPath(config, jobId, segments);
  return Bun.file(path).exists();
}

export async function deleteJobArtifact(
  config: AppConfig,
  jobId: string,
  segments: string[],
): Promise<void> {
  const path = jobArtifactPath(config, jobId, segments);
  await Bun.file(path)
    .delete()
    .catch(() => {
      // Best-effort: nothing to clean up if it never existed / the whole job
      // dir was already removed (e.g. concurrent DELETE /jobs/:jobId).
    });
}
