/**
 * sessionStorage-backed variant-set / student-keyed-set credentials, mirroring
 * `job-storage.ts`'s single-job persistence — carried-forward LOW from r7's QA
 * review / r11 DX review (L2): only the single-job flow survived a page
 * refresh before this, forcing a full regenerate if a professor reloaded
 * mid-way through a variant or student-keyed result screen.
 */
const KEYS = {
  variantSet: { id: "pdf-injection.variantSetId", token: "pdf-injection.variantSetAccessToken" },
  studentKeyedSet: {
    id: "pdf-injection.studentKeyedSetId",
    token: "pdf-injection.studentKeyedSetAccessToken",
  },
} as const;

export type SetKind = keyof typeof KEYS;

export interface StoredSetCredentials {
  id: string;
  accessToken: string;
}

export function saveSetCredentials(kind: SetKind, credentials: StoredSetCredentials): void {
  const keys = KEYS[kind];
  sessionStorage.setItem(keys.id, credentials.id);
  sessionStorage.setItem(keys.token, credentials.accessToken);
}

export function loadSetCredentials(kind: SetKind): StoredSetCredentials | null {
  const keys = KEYS[kind];
  const id = sessionStorage.getItem(keys.id);
  const accessToken = sessionStorage.getItem(keys.token);
  if (!id || !accessToken) return null;
  return { id, accessToken };
}

export function clearSetCredentials(kind: SetKind): void {
  const keys = KEYS[kind];
  sessionStorage.removeItem(keys.id);
  sessionStorage.removeItem(keys.token);
}

export function clearAllSetCredentials(): void {
  clearSetCredentials("variantSet");
  clearSetCredentials("studentKeyedSet");
}
