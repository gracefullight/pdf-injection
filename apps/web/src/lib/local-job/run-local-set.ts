import type { StudentKeyedSetResponse, VariantSetResponse } from "@pdf-injection/contracts";
import {
  DEFAULT_KEY_LENGTH,
  generateUniqueStudentKeys,
  substituteKey,
  substituteSignalKeys,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation/hash";
import type { CreateStudentKeyedSetInput, CreateVariantSetInput } from "@/lib/api-variant-sets";
import { putLocalJob } from "@/lib/local-job/local-job-store";
import {
  type LocalSet,
  type LocalSetMember,
  localSetAccessToken,
  newLocalSetId,
  putLocalSet,
} from "@/lib/local-job/local-set-store";
import { runLocalJob } from "@/lib/local-job/run-local-job";

/**
 * On-device equivalents of `POST /variant-sets` and
 * `POST /student-keyed-sets`: run the local injection pipeline once per member
 * and register the result as a set.
 *
 * Key generation and `{{KEY}}` substitution come from
 * `@pdf-injection/contracts` — the same code `apps/api` runs — so a locally
 * built set is indistinguishable from a server-built one apart from where the
 * bytes live.
 *
 * Member failures are per-member, matching the server contract: one variant
 * with an unusable instruction does not fail the whole set; it is reported with
 * an empty `jobId` and a `failed` status.
 */

interface MemberOutcome {
  member: LocalSetMember;
  accessToken: string | null;
  errorCode: string | null;
}

function errorCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "INJECTION_FAILED";
}

async function runMember(
  file: File,
  label: string,
  key: string | null,
  instruction: string,
  signals: CreateVariantSetInput["variants"][number]["expectedSignals"],
  settings: Omit<CreateVariantSetInput, "file" | "variants">,
): Promise<MemberOutcome> {
  try {
    const { job } = await runLocalJob({
      file,
      instruction,
      expectedSignals: signals,
      injectionMode: settings.injectionMode,
      targetPage: settings.targetPage,
      position: settings.position,
      x: settings.x,
      y: settings.y,
      fontSize: settings.fontSize,
      maxWidth: settings.maxWidth,
      payloadLanguage: settings.payloadLanguage,
      acknowledgedWarnings: settings.acknowledgedWarnings,
    });
    putLocalJob(job);
    return {
      member: { label, jobId: job.jobId, key },
      accessToken: job.accessToken,
      errorCode: null,
    };
  } catch (error) {
    // Contract: partial failures are reported per member, with "" as the
    // documented sentinel for "no job was created".
    return { member: { label, jobId: "", key }, accessToken: null, errorCode: errorCodeOf(error) };
  }
}

export async function runLocalVariantSet(
  input: CreateVariantSetInput,
): Promise<VariantSetResponse> {
  const { file, variants, ...settings } = input;
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const createdAt = new Date().toISOString();
  const setId = newLocalSetId();

  const outcomes: MemberOutcome[] = [];
  for (const variant of variants) {
    outcomes.push(
      await runMember(
        file,
        variant.label,
        null,
        variant.instruction,
        variant.expectedSignals,
        settings,
      ),
    );
  }

  const set: LocalSet = {
    setId,
    kind: "variant",
    accessToken: localSetAccessToken(),
    sourceFilename: file.name,
    sourceSha256: sha256Hex(sourceBytes),
    createdAt,
    members: outcomes.filter((o) => o.member.jobId !== "").map((o) => o.member),
    distribution: null,
  };
  putLocalSet(set);

  return {
    variantSetId: setId,
    accessToken: set.accessToken,
    sourceSha256: set.sourceSha256,
    createdAt,
    variants: outcomes.map((outcome) => ({
      label: outcome.member.label,
      jobId: outcome.member.jobId,
      accessToken: outcome.accessToken,
      status: outcome.errorCode === null ? ("completed" as const) : ("failed" as const),
      errorCode: outcome.errorCode,
    })),
  };
}

export async function runLocalStudentKeyedSet(
  input: CreateStudentKeyedSetInput,
): Promise<StudentKeyedSetResponse> {
  const { file, instructionTemplate, expectedSignals, studentIds, keyLength, ...settings } = input;

  if (!instructionTemplate.includes("{{KEY}}")) {
    throw new Error("instructionTemplate must contain the {{KEY}} placeholder");
  }

  const keys = generateUniqueStudentKeys(studentIds.length, keyLength ?? DEFAULT_KEY_LENGTH);
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const createdAt = new Date().toISOString();
  const setId = newLocalSetId();

  const outcomes: MemberOutcome[] = [];
  for (let i = 0; i < studentIds.length; i++) {
    const studentId = studentIds[i] as string;
    const key = keys[i] as string;
    outcomes.push(
      await runMember(
        file,
        studentId,
        key,
        substituteKey(instructionTemplate, key),
        substituteSignalKeys(expectedSignals, key),
        settings,
      ),
    );
  }

  const set: LocalSet = {
    setId,
    kind: "student_keyed",
    accessToken: localSetAccessToken(),
    sourceFilename: file.name,
    sourceSha256: sha256Hex(sourceBytes),
    createdAt,
    members: outcomes.filter((o) => o.member.jobId !== "").map((o) => o.member),
    distribution: null,
  };
  putLocalSet(set);

  return {
    setId,
    accessToken: set.accessToken,
    sourceSha256: set.sourceSha256,
    createdAt,
    students: outcomes.map((outcome) => ({
      studentId: outcome.member.label,
      key: outcome.member.key ?? "",
      jobId: outcome.member.jobId,
      accessToken: outcome.accessToken,
      status: outcome.errorCode === null ? ("completed" as const) : ("failed" as const),
      errorCode: outcome.errorCode,
    })),
  };
}
