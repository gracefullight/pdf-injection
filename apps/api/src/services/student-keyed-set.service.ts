import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExpectedSignal,
  JobStatus,
  StudentKeyedSetResponse,
  StudentKeySummary,
} from "@pdf-injection/contracts";
import {
  DEFAULT_KEY_LENGTH,
  generateUniqueStudentKeys,
  isExpectedSignalArray,
  MAX_KEY_LENGTH,
  MIN_KEY_LENGTH,
  mappingToCsv,
  parseStudentIds,
  substituteKey,
  substituteSignalKeys,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { buildZip, type ZipEntry } from "../lib/zip";
import { generateAccessToken, hashAccessToken } from "../middleware/access-token";
import type { JobsRepository } from "../repositories/jobs.repository";
import type { VariantSetsRepository } from "../repositories/variant-sets.repository";
import { sanitizeArchiveSegment, sanitizeFilenameStem } from "../storage";
import {
  type CreateJobFields,
  createJob,
  deleteJob,
  getJobStatus,
  getOutputPdf,
} from "./job.service";

export interface StudentKeyedSetServiceDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  variantSetsRepo: VariantSetsRepository;
}

export interface CreateStudentKeyedSetFields {
  file: File;
  instructionTemplate: string;
  expectedSignalsJson: string;
  studentIdsJson: string;
  keyLengthRaw: string | null;
  injectionMode: string;
  targetPageRaw: string | null;
  positionRaw: string | null;
  xRaw: string | null;
  yRaw: string | null;
  fontSizeRaw: string | null;
  maxWidthRaw: string | null;
  payloadLanguageRaw: string | null;
  acknowledgedWarningsRaw: string | null;
}

interface MetaStudentEntry {
  studentId: string;
  key: string;
  jobId: string; // "" when pre-processing rejection prevented job creation
  status: JobStatus;
  errorCode: string | null;
}

interface SetMeta {
  sourceFilename: string;
  students: MetaStudentEntry[];
}

function parseKeyLength(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_KEY_LENGTH;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_KEY_LENGTH || n > MAX_KEY_LENGTH) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `keyLength must be an integer between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH}`,
    );
  }
  return n;
}

function parseExpectedSignalsTemplate(json: string): ExpectedSignal[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "expectedSignals is not valid JSON");
  }
  if (!isExpectedSignalArray(parsed)) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "expectedSignals does not match ExpectedSignal[] schema",
    );
  }
  return parsed;
}

/** Substitutes {{KEY}} inside every `exact_phrase.value` (the only signal shape the contract allows a per-student template in). */
function toStudentKeySummary(
  entry: MetaStudentEntry,
  accessToken: string | null,
): StudentKeySummary {
  return {
    studentId: entry.studentId,
    key: entry.key,
    jobId: entry.jobId,
    // null (not "") once not freshly returned — see UX C-02: the set's own
    // token now authorizes reads against every member job directly.
    accessToken,
    status: entry.status,
    errorCode: entry.errorCode,
  };
}

export async function createStudentKeyedSet(
  deps: StudentKeyedSetServiceDeps,
  fields: CreateStudentKeyedSetFields,
): Promise<StudentKeyedSetResponse> {
  const { config, jobsRepo, variantSetsRepo } = deps;

  if (!fields.instructionTemplate.includes("{{KEY}}")) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "instructionTemplate must contain the {{KEY}} placeholder",
    );
  }
  const signalsTemplate = parseExpectedSignalsTemplate(fields.expectedSignalsJson);
  const keyLength = parseKeyLength(fields.keyLengthRaw);

  let studentIds: string[];
  try {
    studentIds = parseStudentIds(fields.studentIdsJson, config.maxStudentKeys);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/limit is/.test(message)) {
      throw new ApiError("TOO_MANY_STUDENTS", message);
    }
    throw new ApiError("VALIDATION_ERROR", message);
  }

  const keys = generateUniqueStudentKeys(studentIds.length, keyLength);

  const sourceBytes = new Uint8Array(await fields.file.arrayBuffer());
  const sourceSha256 = sha256Hex(sourceBytes);

  const setId = crypto.randomUUID();
  const setAccessToken = generateAccessToken();
  const setAccessTokenHash = hashAccessToken(setAccessToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.retentionHours * 60 * 60 * 1000);

  const metaStudents: MetaStudentEntry[] = [];
  const responseStudents: StudentKeySummary[] = [];

  for (let i = 0; i < studentIds.length; i++) {
    const studentId = studentIds[i]!;
    const key = keys[i]!;
    const instruction = substituteKey(fields.instructionTemplate, key);
    const expectedSignals = substituteSignalKeys(signalsTemplate, key);

    const jobFields: CreateJobFields = {
      file: fields.file,
      instruction,
      expectedSignalsJson: JSON.stringify(expectedSignals),
      injectionMode: fields.injectionMode,
      targetPageRaw: fields.targetPageRaw,
      positionRaw: fields.positionRaw,
      xRaw: fields.xRaw,
      yRaw: fields.yRaw,
      fontSizeRaw: fields.fontSizeRaw,
      maxWidthRaw: fields.maxWidthRaw,
      acknowledgedWarningsRaw: fields.acknowledgedWarningsRaw,
      payloadLanguageRaw: fields.payloadLanguageRaw,
    };

    try {
      const result = await createJob({ config, jobsRepo }, jobFields);
      jobsRepo.setSetId(result.jobId, setId);
      variantSetsRepo.insertMember({
        setId,
        labelOrStudentId: studentId,
        jobId: result.jobId,
        keyOrNull: key,
      });
      metaStudents.push({
        studentId,
        key,
        jobId: result.jobId,
        status: result.status,
        errorCode: result.errorCode,
      });
      responseStudents.push(
        toStudentKeySummary(metaStudents[metaStudents.length - 1]!, result.accessToken),
      );
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "INJECTION_FAILED";
      metaStudents.push({ studentId, key, jobId: "", status: "failed", errorCode: code });
      responseStudents.push(toStudentKeySummary(metaStudents[metaStudents.length - 1]!, null));
    }
  }

  const meta: SetMeta = { sourceFilename: fields.file.name, students: metaStudents };

  variantSetsRepo.insertSet({
    id: setId,
    kind: "student_keyed",
    accessTokenHash: setAccessTokenHash,
    sourceSha256,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metaJson: JSON.stringify(meta),
  });

  // mapping.json: PRIVATE, keys only ever persisted here + per-job manifests.
  const filePath = mappingFilePath(config, setId);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(
    filePath,
    JSON.stringify(
      {
        warning: "PRIVATE — contains every student's access key. Do not distribute to students.",
        setId,
        students: metaStudents,
      },
      null,
      2,
    ),
  );

  return {
    setId,
    accessToken: setAccessToken,
    sourceSha256,
    createdAt: now.toISOString(),
    students: responseStudents,
  };
}

export async function getStudentKeyedSet(
  deps: StudentKeyedSetServiceDeps,
  setId: string,
): Promise<StudentKeyedSetResponse> {
  const { config, variantSetsRepo, jobsRepo } = deps;
  const set = variantSetsRepo.findById(setId);
  if (set?.kind !== "student_keyed") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const meta = JSON.parse(set.metaJson) as SetMeta;

  const students: StudentKeySummary[] = [];
  for (const entry of meta.students) {
    if (entry.jobId === "") {
      students.push(toStudentKeySummary(entry, null));
      continue;
    }
    const job = jobsRepo.findById(entry.jobId);
    if (!job) {
      students.push(toStudentKeySummary(entry, null));
      continue;
    }
    const status = await getJobStatus({ config, jobsRepo }, job);
    students.push({
      studentId: entry.studentId,
      key: entry.key,
      jobId: job.id,
      accessToken: null, // only returned once, at creation time (UX C-02: use the set's own token instead)
      status: status.status,
      errorCode: status.errorCode,
    });
  }

  return {
    setId: set.id,
    accessToken: "",
    sourceSha256: set.sourceSha256,
    createdAt: set.createdAt,
    students,
  };
}

function setDir(config: AppConfig, setId: string): string {
  return `${config.storageDir}/sets/${setId}`;
}

function mappingFilePath(config: AppConfig, setId: string): string {
  return `${setDir(config, setId)}/mapping.json`;
}

/** GET /student-keyed-sets/:id/mapping — studentId,key,jobId,outputSha256 (PRIVATE, never logged). */
export async function getMappingCsv(
  deps: StudentKeyedSetServiceDeps,
  setId: string,
): Promise<string> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "student_keyed") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const meta = JSON.parse(set.metaJson) as SetMeta;

  const lines = ["studentId,key,jobId,outputSha256"];
  for (const entry of meta.students) {
    const job = entry.jobId !== "" ? deps.jobsRepo.findById(entry.jobId) : null;
    const outputSha256 = job?.outputSha256 ?? "";
    lines.push(
      `${csvField(entry.studentId)},${csvField(entry.key)},${csvField(entry.jobId)},${csvField(outputSha256)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function buildStudentKeyedSetArchive(
  deps: StudentKeyedSetServiceDeps,
  setId: string,
): Promise<Uint8Array> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "student_keyed") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const members = deps.variantSetsRepo.findMembers(setId).filter((m) => m.jobId !== "");
  const meta = JSON.parse(set.metaJson) as SetMeta;
  const stem = sanitizeFilenameStem(meta.sourceFilename);

  const entries: ZipEntry[] = [];
  for (const member of members) {
    const job = deps.jobsRepo.findById(member.jobId);
    if (job?.status !== "completed") continue;
    const { bytes } = await getOutputPdf({ config: deps.config, jobsRepo: deps.jobsRepo }, job);
    // CWE-22 (Zip Slip) fix: labelOrStudentId is user-supplied (studentId)
    // and only length-validated at the schema level — sanitize before
    // embedding it in a zip entry path. buildZip() also independently
    // rejects any residual path separator.
    entries.push({
      path: `${stem}.${sanitizeArchiveSegment(member.labelOrStudentId)}.injected.pdf`,
      data: bytes,
    });
  }
  return buildZip(entries);
}

/** DELETE /student-keyed-sets/:id cascade: every member job (files + row) + the set row. */
export async function deleteStudentKeyedSet(
  deps: StudentKeyedSetServiceDeps,
  setId: string,
): Promise<void> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "student_keyed") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const members = deps.variantSetsRepo.findMembers(setId);
  for (const member of members) {
    if (member.jobId === "") continue;
    await deleteJob({ config: deps.config, jobsRepo: deps.jobsRepo }, member.jobId);
  }
  await rm(setDir(deps.config, setId), { recursive: true, force: true });
  deps.variantSetsRepo.deleteSet(setId);
}
