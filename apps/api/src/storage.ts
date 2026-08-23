import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "./config";
import { ApiError } from "./errors";

// UUID v4 (server-generated jobId). Validated before any path is built from
// a client-supplied :jobId route param, so path traversal is impossible.
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidJobId(id: string): boolean {
  return JOB_ID_RE.test(id);
}

/**
 * Validates a client-supplied jobId and returns its storage directory.
 * Throws JOB_NOT_FOUND (never leaks path-traversal-relevant details) when
 * the id is not a well-formed UUID v4 — malformed ids can never correspond
 * to a real job, so this is indistinguishable from "job doesn't exist".
 */
export function jobDir(config: AppConfig, jobId: string): string {
  if (!isValidJobId(jobId)) {
    throw new ApiError("JOB_NOT_FOUND");
  }
  return join(config.storageDir, jobId);
}

export type JobFileName = "source.pdf" | "output.pdf" | "manifest.json" | "report.json";

export function jobFilePath(config: AppConfig, jobId: string, name: JobFileName): string {
  return join(jobDir(config, jobId), name);
}

export async function writeJobFile(
  config: AppConfig,
  jobId: string,
  name: JobFileName,
  data: Uint8Array | string,
): Promise<void> {
  await Bun.write(jobFilePath(config, jobId, name), data);
}

export async function readJobFileBytes(
  config: AppConfig,
  jobId: string,
  name: JobFileName,
): Promise<Uint8Array> {
  const file = Bun.file(jobFilePath(config, jobId, name));
  return new Uint8Array(await file.arrayBuffer());
}

export async function readJobFileText(
  config: AppConfig,
  jobId: string,
  name: JobFileName,
): Promise<string> {
  return Bun.file(jobFilePath(config, jobId, name)).text();
}

export async function jobFileExists(
  config: AppConfig,
  jobId: string,
  name: JobFileName,
): Promise<boolean> {
  return Bun.file(jobFilePath(config, jobId, name)).exists();
}

export async function deleteJobDir(config: AppConfig, jobId: string): Promise<void> {
  const dir = jobDir(config, jobId);
  await rm(dir, { recursive: true, force: true });
}

/**
 * Sanitizes a source filename down to a safe "stem" used for download
 * filenames (never the raw client-supplied name, never used as a path
 * segment). API contract: `[^A-Za-z0-9._-]` -> `_`, max 100 chars, no
 * extension.
 */
// `sanitizeFilenameStem` / `sanitizeArchiveSegment` moved to
// `@pdf-injection/contracts` (src/sets.ts) so apps/web's on-device set flows
// produce byte-identical archive entry names. Re-exported here so this
// module stays the single import site for the rest of apps/api.
export { sanitizeArchiveSegment, sanitizeFilenameStem } from "@pdf-injection/contracts";
