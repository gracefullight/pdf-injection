/** sessionStorage-backed job credentials so a page refresh doesn't lose the access token. */
const JOB_ID_KEY = "pdf-injection.jobId";
const ACCESS_TOKEN_KEY = "pdf-injection.accessToken";

export interface StoredJobCredentials {
  jobId: string;
  accessToken: string;
}

export function saveJobCredentials(credentials: StoredJobCredentials): void {
  sessionStorage.setItem(JOB_ID_KEY, credentials.jobId);
  sessionStorage.setItem(ACCESS_TOKEN_KEY, credentials.accessToken);
}

export function loadJobCredentials(): StoredJobCredentials | null {
  const jobId = sessionStorage.getItem(JOB_ID_KEY);
  const accessToken = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (!jobId || !accessToken) return null;
  return { jobId, accessToken };
}

export function clearJobCredentials(): void {
  sessionStorage.removeItem(JOB_ID_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
}
