// Round-2 §1 student-keyed sets: per-student access keys. Unambiguous
// charset (no 0/O/1/I/L) so keys are easy to read aloud/transcribe; crypto
// random, generated with rejection sampling to avoid modulo bias; unique
// within a single set (retried on collision). Never logged.
export const STUDENT_KEY_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const MIN_KEY_LENGTH = 6;
export const MAX_KEY_LENGTH = 16;
export const DEFAULT_KEY_LENGTH = 8;

/** Generates one random key of `length` characters from STUDENT_KEY_CHARSET. */
export function generateStudentKey(length: number): string {
  const charsetLen = STUDENT_KEY_CHARSET.length;
  // Rejection sampling: charsetLen=32, so a single random byte (0-255) maps
  // evenly (256 is an exact multiple of 32) — no bias, no rejection needed
  // in practice, but the guard is kept for correctness if the charset ever
  // changes to a non-power-of-two-friendly length.
  const maxUnbiased = 256 - (256 % charsetLen);
  let out = "";
  const buf = new Uint8Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    const byte = buf[0]!;
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
