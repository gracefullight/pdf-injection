import type {
  DistributionRequest,
  DistributionResponse,
  ExpectedSignal,
  InjectionMode,
  PayloadLanguage,
  Position,
  StudentKeyedSetResponse,
  TargetPage,
  VariantSetResponse,
  VariantSpec,
} from "@pdf-injection/contracts";
import { eden, unwrapEdenAs } from "@/lib/eden-client";
import {
  buildLocalDistribution,
  deleteLocalSet,
  isLocalSetId,
  localDistributionCsv,
  localMappingCsv,
  localSetArchive,
  localStudentKeyedSetResponse,
  localVariantSetResponse,
} from "@/lib/local-job/local-set-store";
import { runLocalStudentKeyedSet, runLocalVariantSet } from "@/lib/local-job/run-local-set";
import { isLocalModeEnabled } from "@/lib/local-mode";
import {
  API_PREFIX,
  authHeaders,
  type DownloadedFile,
  downloadFile,
  fetchJson,
  ResearchApiError,
  toFormData,
} from "@/lib/research-fetch";

/**
 * `apps/api/src/routes/variant-sets.ts` / `routes/student-keyed-sets.ts` are now registered on
 * the Elysia `App` type (`eden-client.ts`), so the plain-JSON endpoints below (get/distribution
 * POST/delete for both resources) go through Eden Treaty, unwrapped into the same
 * `ResearchApiError` class every other function in this module already throws (via
 * `research-fetch.ts`'s `fetchJson`), so `instanceof ResearchApiError` checks in
 * the UI (`distribution-builder.tsx`, `variant-set-result-screen.tsx`,
 * `student-keyed-set-result-screen.tsx`) keep working unchanged.
 *
 * Multipart create (`createVariantSet`/`createStudentKeyedSet`), CSV downloads (distribution,
 * mapping — both routes union a JSON/raw-`Response` return type on the `format` query param, or
 * are CSV-only), and ZIP archive downloads stay on typed `fetch` via `research-fetch.ts` — same
 * binary/multipart/CSV/ZIP rationale as `lib/api.ts`'s module doc.
 */
function unwrap<T>(result: { data: unknown; error: unknown; status: number }): T {
  return unwrapEdenAs<T, ResearchApiError>(result, ResearchApiError);
}

/** Shared injection-settings fields reused by variant-set / student-keyed-set creation (contract §1). */
interface InjectionFields {
  injectionMode: InjectionMode;
  targetPage?: TargetPage;
  position?: Position;
  x?: number;
  y?: number;
  fontSize?: number;
  maxWidth?: number;
  payloadLanguage?: PayloadLanguage;
  acknowledgedWarnings?: string[];
}

function injectionFieldsToFormFields(input: InjectionFields): Record<string, string | undefined> {
  return {
    injectionMode: input.injectionMode,
    targetPage: input.targetPage !== undefined ? String(input.targetPage) : undefined,
    position: input.position,
    x: input.x !== undefined ? String(input.x) : undefined,
    y: input.y !== undefined ? String(input.y) : undefined,
    fontSize: input.fontSize !== undefined ? String(input.fontSize) : undefined,
    maxWidth: input.maxWidth !== undefined ? String(input.maxWidth) : undefined,
    payloadLanguage: input.payloadLanguage,
    acknowledgedWarnings: input.acknowledgedWarnings
      ? JSON.stringify(input.acknowledgedWarnings)
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Variant sets
// ---------------------------------------------------------------------------

export interface CreateVariantSetInput extends InjectionFields {
  file: File;
  variants: VariantSpec[];
}

export async function createVariantSet(input: CreateVariantSetInput): Promise<VariantSetResponse> {
  if (isLocalModeEnabled()) return runLocalVariantSet(input);
  const formData = toFormData({
    file: input.file,
    variants: JSON.stringify(input.variants),
    ...injectionFieldsToFormFields(input),
  });
  return fetchJson<VariantSetResponse>(`${API_PREFIX}/variant-sets`, {
    method: "POST",
    body: formData,
  });
}

export async function getVariantSet(id: string, accessToken: string): Promise<VariantSetResponse> {
  if (isLocalSetId(id)) return localVariantSetResponse(id);
  const result = await eden.api.v1["variant-sets"]({ id }).get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<VariantSetResponse>(result);
}

export interface CreateDistributionInput {
  setId: string;
  accessToken: string;
  body: DistributionRequest;
}

export async function postDistribution(
  input: CreateDistributionInput,
): Promise<DistributionResponse> {
  if (isLocalSetId(input.setId)) return buildLocalDistribution(input.setId, input.body);
  const result = await eden.api.v1["variant-sets"]({ id: input.setId }).distribution.post(
    input.body as never,
    {
      headers: authHeaders(input.accessToken) as Record<string, string>,
    },
  );
  return unwrap<DistributionResponse>(result);
}

export function getDistributionCsvUrl(setId: string): string {
  return `${API_PREFIX}/variant-sets/${setId}/distribution?format=csv`;
}

export async function downloadDistributionCsv(
  setId: string,
  accessToken: string,
  stem: string,
): Promise<DownloadedFile> {
  if (isLocalSetId(setId)) return localDistributionCsv(setId, stem);
  return downloadFile(getDistributionCsvUrl(setId), accessToken, `${stem}.distribution.csv`);
}

export async function downloadVariantSetArchive(
  setId: string,
  accessToken: string,
  stem: string,
): Promise<DownloadedFile> {
  if (isLocalSetId(setId)) return localSetArchive(setId, stem);
  return downloadFile(
    `${API_PREFIX}/variant-sets/${setId}/archive`,
    accessToken,
    `${stem}.variant-set.zip`,
  );
}

export async function deleteVariantSet(setId: string, accessToken: string): Promise<void> {
  if (isLocalSetId(setId)) {
    deleteLocalSet(setId);
    return;
  }
  const result = await eden.api.v1["variant-sets"]({ id: setId }).delete(undefined, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  if (result.status !== 204) {
    unwrap(result);
  }
}

// ---------------------------------------------------------------------------
// Student-keyed sets
// ---------------------------------------------------------------------------

export interface CreateStudentKeyedSetInput extends InjectionFields {
  file: File;
  instructionTemplate: string;
  expectedSignals: ExpectedSignal[];
  studentIds: string[];
  keyLength?: number;
}

export async function createStudentKeyedSet(
  input: CreateStudentKeyedSetInput,
): Promise<StudentKeyedSetResponse> {
  if (isLocalModeEnabled()) return runLocalStudentKeyedSet(input);
  const formData = toFormData({
    file: input.file,
    instructionTemplate: input.instructionTemplate,
    expectedSignals: JSON.stringify(input.expectedSignals),
    studentIds: JSON.stringify(input.studentIds),
    keyLength: input.keyLength !== undefined ? String(input.keyLength) : undefined,
    ...injectionFieldsToFormFields(input),
  });
  return fetchJson<StudentKeyedSetResponse>(`${API_PREFIX}/student-keyed-sets`, {
    method: "POST",
    body: formData,
  });
}

export async function getStudentKeyedSet(
  id: string,
  accessToken: string,
): Promise<StudentKeyedSetResponse> {
  if (isLocalSetId(id)) return localStudentKeyedSetResponse(id);
  const result = await eden.api.v1["student-keyed-sets"]({ id }).get({
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  return unwrap<StudentKeyedSetResponse>(result);
}

export function getMappingCsvUrl(setId: string): string {
  return `${API_PREFIX}/student-keyed-sets/${setId}/mapping?format=csv`;
}

/** PRIVATE: contains the student id -> access key mapping. Never displayed inline, download only. */
export async function downloadMappingCsv(
  setId: string,
  accessToken: string,
  stem: string,
): Promise<DownloadedFile> {
  if (isLocalSetId(setId)) return localMappingCsv(setId, stem);
  return downloadFile(getMappingCsvUrl(setId), accessToken, `${stem}.mapping.csv`);
}

export async function downloadStudentKeyedSetArchive(
  setId: string,
  accessToken: string,
  stem: string,
): Promise<DownloadedFile> {
  if (isLocalSetId(setId)) return localSetArchive(setId, stem);
  return downloadFile(
    `${API_PREFIX}/student-keyed-sets/${setId}/archive`,
    accessToken,
    `${stem}.student-keyed-set.zip`,
  );
}

export async function deleteStudentKeyedSet(setId: string, accessToken: string): Promise<void> {
  if (isLocalSetId(setId)) {
    deleteLocalSet(setId);
    return;
  }
  const result = await eden.api.v1["student-keyed-sets"]({ id: setId }).delete(undefined, {
    headers: authHeaders(accessToken) as Record<string, string>,
  });
  if (result.status !== 204) {
    unwrap(result);
  }
}
