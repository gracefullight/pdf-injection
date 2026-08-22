// PDF Standard Security Handler, Revision 2 / V1 (40-bit RC4). Pure TypeScript
// implementation of the algorithms in the PDF 1.7 spec (7.6.3), used by
// scripts/generate-fixtures.ts to (re)generate tests/fixtures/encrypted.pdf
// without any out-of-band tooling (round 2 §0.1 — "no Python anywhere").
//
// Algorithm 1 (per-object encryption key), Algorithm 2 (file encryption
// key), Algorithm 3 (O value), Algorithm 4 (U value, revision 2 — no MD5 of
// the padding string, unlike revision 3+'s Algorithm 5).

/** Standard 32-byte padding string (PDF 1.7 spec §7.6.3.3, Algorithm 2). */
export const STANDARD_PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export function md5(bytes: Uint8Array): Uint8Array {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(bytes);
  return new Uint8Array(hasher.digest());
}

/** RC4 stream cipher (symmetric: same function encrypts and decrypts). */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + (s[i] as number) + (key[i % key.length] as number)) & 0xff;
    const tmp = s[i] as number;
    s[i] = s[j] as number;
    s[j] = tmp;
  }

  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + (s[i] as number)) & 0xff;
    const tmp = s[i] as number;
    s[i] = s[j] as number;
    s[j] = tmp;
    const t = ((s[i] as number) + (s[j] as number)) & 0xff;
    out[k] = (data[k] as number) ^ (s[t] as number);
  }
  return out;
}

export function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const n = Math.min(password.length, 32);
  out.set(password.subarray(0, n));
  out.set(STANDARD_PAD.subarray(0, 32 - n), n);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 4-byte little-endian encoding of a signed 32-bit permissions integer. */
export function int32LE(n: number): Uint8Array {
  const unsigned = n >>> 0;
  return new Uint8Array([
    unsigned & 0xff,
    (unsigned >>> 8) & 0xff,
    (unsigned >>> 16) & 0xff,
    (unsigned >>> 24) & 0xff,
  ]);
}

export interface StandardSecurityHandlerR2Input {
  userPassword?: string;
  ownerPassword?: string;
  /** Signed 32-bit permissions integer. Default -4 (0xFFFFFFFC): allow print/modify/copy/annotate, R2 reserved bits set per spec. */
  permissions?: number;
  /** First element of the document's /ID array — exactly 16 bytes. */
  id: Uint8Array;
}

export interface StandardSecurityHandlerR2 {
  /** 32-byte O (owner password) entry. */
  O: Uint8Array;
  /** 32-byte U (user password) entry. */
  U: Uint8Array;
  P: number;
  /** 5-byte (40-bit) file encryption key. */
  fileKey: Uint8Array;
  id: Uint8Array;
}

/**
 * Computes O, U, and the file encryption key for the PDF Standard Security
 * Handler, Revision 2 (40-bit RC4, V=1). PDF 1.7 spec §7.6.3.4 Algorithms
 * 2-4.
 */
export function buildStandardSecurityHandlerR2(
  input: StandardSecurityHandlerR2Input,
): StandardSecurityHandlerR2 {
  if (input.id.length !== 16) {
    throw new Error(`id must be exactly 16 bytes, got ${input.id.length}`);
  }

  const userPw = padPassword(new TextEncoder().encode(input.userPassword ?? ""));
  const ownerPw = padPassword(
    new TextEncoder().encode(input.ownerPassword ?? input.userPassword ?? ""),
  );
  const P = input.permissions ?? -4;

  // Algorithm 3 — compute O.
  const ownerHash = md5(ownerPw);
  const rc4KeyForO = ownerHash.subarray(0, 5);
  const O = rc4(rc4KeyForO, userPw);

  // Algorithm 2 — compute the file encryption key.
  const keyInput = concatBytes(userPw, O, int32LE(P), input.id);
  const fileKey = md5(keyInput).subarray(0, 5);

  // Algorithm 4 (revision 2) — compute U: RC4-encrypt the padding string
  // directly with the file key (no MD5(pad + id) step — that's Algorithm 5,
  // for revision >= 3).
  const U = rc4(fileKey, STANDARD_PAD);

  return { O, U, P, fileKey, id: input.id };
}

/** Algorithm 1 — per-object RC4 key derived from the file key + object/generation numbers. */
export function objectEncryptionKey(
  fileKey: Uint8Array,
  objectNumber: number,
  generationNumber: number,
): Uint8Array {
  const objBytes = new Uint8Array([
    objectNumber & 0xff,
    (objectNumber >>> 8) & 0xff,
    (objectNumber >>> 16) & 0xff,
  ]);
  const genBytes = new Uint8Array([generationNumber & 0xff, (generationNumber >>> 8) & 0xff]);
  const hash = md5(concatBytes(fileKey, objBytes, genBytes));
  const n = Math.min(fileKey.length + 5, 16);
  return hash.subarray(0, n);
}

/** Encrypts (or decrypts — RC4 is symmetric) a string/stream's bytes for a given object. */
export function encryptObjectBytes(
  fileKey: Uint8Array,
  objectNumber: number,
  generationNumber: number,
  data: Uint8Array,
): Uint8Array {
  return rc4(objectEncryptionKey(fileKey, objectNumber, generationNumber), data);
}

/** Escapes raw bytes as a PDF literal string `(...)`, octal-escaping non-printable/reserved bytes. */
export function pdfLiteralString(bytes: Uint8Array): string {
  let out = "(";
  for (const b of bytes) {
    if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b === 0x5c) out += "\\\\";
    else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  out += ")";
  return out;
}
