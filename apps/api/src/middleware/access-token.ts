import { sha256Hex } from "@pdf-injection/validation";
import { ApiError } from "../errors";
import type { JobsRepository, StoredJobRow } from "../repositories/jobs.repository";
import type { VariantSetsRepository } from "../repositories/variant-sets.repository";

/** Generates a per-job access token: 32 random bytes, base64url-encoded. */
export function generateAccessToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function hashAccessToken(token: string): string {
  return sha256Hex(token);
}

/** Constant-time comparison of two equal-length hex/base64url strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Loads a job by id and verifies X-Job-Token against its stored hash, OR
 * (round-2 §1, UX C-02) against the access token of the variant-set /
 * student-keyed set that owns this job (`jobs.set_id` -> `variant_sets.
 * access_token_hash`), when `variantSetsRepo` is supplied. The set token
 * is an owner-level credential for every one of its member jobs — this is
 * how a "Open variant/student" UI can read a member job's status/source/
 * output/report using only the set token it already has, without the
 * per-member token ever being re-displayed after creation (see
 * `VariantJobSummary`/`StudentKeySummary`'s `accessToken: string | null`).
 * Throws JOB_NOT_FOUND (404) if the job doesn't exist, JOB_FORBIDDEN (403)
 * if neither the job's own token nor (when applicable) its owning set's
 * token match. Used by every /jobs/:jobId* route per the API contract's
 * authentication section.
 */
export function requireJob(
  jobsRepo: JobsRepository,
  jobId: string,
  token: string | undefined | null,
  variantSetsRepo?: VariantSetsRepository,
): StoredJobRow {
  const job = jobsRepo.findById(jobId);
  if (!job) {
    throw new ApiError("JOB_NOT_FOUND");
  }
  if (!token) {
    throw new ApiError("JOB_FORBIDDEN");
  }
  if (timingSafeEqual(hashAccessToken(token), job.accessTokenHash)) {
    return job;
  }
  if (variantSetsRepo && job.setId) {
    const set = variantSetsRepo.findById(job.setId);
    if (set && timingSafeEqual(hashAccessToken(token), set.accessTokenHash)) {
      return job;
    }
  }
  throw new ApiError("JOB_FORBIDDEN");
}
