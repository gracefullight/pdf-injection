import type { DistributionStrategy, ExpectedSignal } from "./types";

/**
 * Pure, runtime-agnostic logic shared by the two set flows (variant sets and
 * student-keyed sets): student-key generation, `{{KEY}}` substitution,
 * distribution assignment, CSV serialization and archive-name sanitization.
 *
 * It lives here — rather than in `apps/api` where it started — because
 * `apps/web` runs the very same flows on-device (local mode) and must produce
 * identical keys, assignments and files. Nothing in this module touches the
 * filesystem, the network or any runtime global beyond `crypto.getRandomValues`,
 * which both Bun and browsers provide.
 */

// ---------------------------------------------------------------------------
// Student keys
// ---------------------------------------------------------------------------

/** Unambiguous charset (no 0/O/1/I/L) so keys are easy to read aloud/transcribe. */
export const STUDENT_KEY_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const MIN_KEY_LENGTH = 6;
export const MAX_KEY_LENGTH = 16;
export const DEFAULT_KEY_LENGTH = 8;

/** Generates one random key of `length` characters from STUDENT_KEY_CHARSET. */
export function generateStudentKey(length: number): string {
  const charsetLen = STUDENT_KEY_CHARSET.length;
  // Rejection sampling: charsetLen=32, so a single random byte (0-255) maps
  // evenly (256 is an exact multiple of 32) — no bias, no rejection needed in
  // practice, but the guard is kept for correctness if the charset changes.
  const maxUnbiased = 256 - (256 % charsetLen);
  let out = "";
  const buf = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    const byte = buf[0] as number;
    if (byte >= maxUnbiased) continue;
    out += STUDENT_KEY_CHARSET[byte % charsetLen];
  }
  return out;
}

/**
 * Generates `count` unique keys of `length` characters each. Throws if
 * uniqueness cannot be achieved within a bounded number of attempts (only
 * plausible if `count` approaches `charset.length ** length`, which never
 * happens at the contract's `maxStudentKeys` = 500 with `length >= 6`).
 */
export function generateUniqueStudentKeys(count: number, length: number): string[] {
  const keys = new Set<string>();
  const maxAttempts = count * 1000 + 1000;
  let attempts = 0;
  while (keys.size < count) {
    if (attempts++ > maxAttempts) {
      throw new Error(
        `Could not generate ${count} unique student keys of length ${length} within ${maxAttempts} attempts`,
      );
    }
    keys.add(generateStudentKey(length));
  }
  return [...keys];
}

/** Substitutes every `{{KEY}}` occurrence in `template` with `key`. */
export function substituteKey(template: string, key: string): string {
  return template.split("{{KEY}}").join(key);
}

/** Applies `{{KEY}}` substitution to the signal types that carry free text. */
export function substituteSignalKeys(signals: ExpectedSignal[], key: string): ExpectedSignal[] {
  return signals.map((signal) =>
    signal.type === "exact_phrase"
      ? { ...signal, value: substituteKey(signal.value, key) }
      : signal,
  );
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export interface DistributionMember {
  label: string;
  jobId: string;
}

export interface DistributionAssignmentResult {
  strategy: DistributionStrategy;
  seed: string | null;
  assignments: Array<{ studentId: string; label: string; jobId: string }>;
  counts: Record<string, number>;
}

/**
 * Assigns students across a variant set's members.
 *
 * `hashModN` is injected because the seeded strategy needs SHA-256, whose
 * implementation lives in `@pdf-injection/validation` — a package that depends
 * on this one, so importing it here would invert the dependency. Callers pass
 * `(input, n) => Number(BigInt("0x" + sha256Hex(input).slice(0, 13)) % BigInt(n))`.
 */
export function buildDistributionAssignments(input: {
  members: DistributionMember[];
  studentIds: string[];
  strategy: DistributionStrategy;
  seed: string | null;
  hashModN: (input: string, n: number) => number;
}): DistributionAssignmentResult {
  const labels = [...input.members].sort((a, b) => a.label.localeCompare(b.label));
  const sortedStudentIds = [...input.studentIds].sort((a, b) => a.localeCompare(b));

  const assignments: DistributionAssignmentResult["assignments"] = [];
  const counts: Record<string, number> = {};
  for (const member of labels) counts[member.label] = 0;

  for (let i = 0; i < sortedStudentIds.length; i++) {
    const studentId = sortedStudentIds[i] as string;
    const index =
      input.strategy === "round_robin"
        ? i % labels.length
        : input.hashModN(`${input.seed}:${studentId}`, labels.length);
    const member = labels[index] as DistributionMember;
    assignments.push({ studentId, label: member.label, jobId: member.jobId });
    counts[member.label] = (counts[member.label] ?? 0) + 1;
  }

  return { strategy: input.strategy, seed: input.seed, assignments, counts };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 quoting: only when the value contains a comma, quote or newline. */
export function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** `studentId,label,jobId` rows for a variant set's distribution. */
export function distributionToCsv(distribution: DistributionAssignmentResult): string {
  const lines = ["studentId,label,jobId"];
  for (const assignment of distribution.assignments) {
    lines.push(
      `${csvField(assignment.studentId)},${csvField(assignment.label)},${csvField(assignment.jobId)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface MappingRow {
  studentId: string;
  key: string;
  jobId: string;
  outputSha256: string;
}

/** `studentId,key,jobId,outputSha256` rows for a student-keyed set. */
export function mappingToCsv(rows: MappingRow[]): string {
  const lines = ["studentId,key,jobId,outputSha256"];
  for (const row of rows) {
    lines.push(
      `${csvField(row.studentId)},${csvField(row.key)},${csvField(row.jobId)},${csvField(row.outputSha256)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Filename / archive-entry sanitization
// ---------------------------------------------------------------------------

/**
 * Derives a safe filename stem from a client-supplied filename:
 * `[^A-Za-z0-9._-]` -> `_`, max 100 chars, extension dropped.
 */
export function sanitizeFilenameStem(filename: string): string {
  const withoutExt = filename.replace(/\.[^./\\]+$/, "");
  const sanitized = withoutExt.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  return sanitized.length > 0 ? sanitized : "document";
}

/**
 * Sanitizes a user-supplied identifier (variant label / student id) for safe
 * embedding in a filename or zip entry path — CWE-22 (Zip Slip) defense in
 * depth. Same charset as `sanitizeFilenameStem`, tighter length, and leading
 * dots stripped so the result can never look like a relative-path segment.
 */
export function sanitizeArchiveSegment(value: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 64);
  return sanitized.length > 0 ? sanitized : "item";
}
