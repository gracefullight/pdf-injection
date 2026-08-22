import { ApiError } from "../errors";
import { hashAccessToken } from "../middleware/access-token";
import type {
  SetKind,
  VariantSetRow,
  VariantSetsRepository,
} from "../repositories/variant-sets.repository";

/** Constant-time comparison of two equal-length strings (mirrors middleware/access-token.ts's private helper). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Loads a variant-set / student-keyed set by id and verifies X-Job-Token
 * against its stored hash (the set's own access token, distinct from each
 * member job's individual token). Throws VARIANT_SET_NOT_FOUND (404) if the
 * set doesn't exist or is the wrong kind, JOB_FORBIDDEN (403) if the token
 * is missing or wrong.
 */
export function requireSet(
  repo: VariantSetsRepository,
  setId: string,
  kind: SetKind,
  token: string | undefined | null,
): VariantSetRow {
  const set = repo.findById(setId);
  if (!set || set.kind !== kind) {
    throw new ApiError("VARIANT_SET_NOT_FOUND");
  }
  if (!token || !timingSafeEqual(hashAccessToken(token), set.accessTokenHash)) {
    throw new ApiError("JOB_FORBIDDEN");
  }
  return set;
}
