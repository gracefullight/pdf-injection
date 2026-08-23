import type {
  DistributionRequest,
  DistributionResponse,
  StudentKeyedSetResponse,
  VariantSetResponse,
} from "@pdf-injection/contracts";
import {
  buildDistributionAssignments,
  distributionToCsv,
  mappingToCsv,
  sanitizeArchiveSegment,
  sanitizeFilenameStem,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation/hash";
import { strToU8, zipSync } from "fflate";
import type { DownloadedFile } from "@/lib/api";
import { getLocalJob } from "@/lib/local-job/local-job-store";
import { LOCAL_JOB_ID_PREFIX } from "@/lib/local-job/run-local-job";

/**
 * In-memory registry for locally generated *sets* — the variant (A/B/…) and
 * student-keyed distribution flows — mirroring `local-job-store.ts` for single
 * jobs. Memory-only for the same reason: a set's manifests and mapping CSV
 * carry every hidden instruction and every student's access key in plain text.
 *
 * The assignment, CSV and archive-name logic is imported from
 * `@pdf-injection/contracts` (`src/sets.ts`) — the exact code `apps/api` runs —
 * so a set built on-device is interchangeable with a server-built one.
 */

export interface LocalSetMember {
  /** Variant label, or student id for a student-keyed set. */
  label: string;
  jobId: string;
  /** Per-student access key; null for variant sets. */
  key: string | null;
}

export interface LocalSet {
  setId: string;
  kind: "variant" | "student_keyed";
  accessToken: string;
  sourceFilename: string;
  sourceSha256: string;
  createdAt: string;
  members: LocalSetMember[];
  /** Last distribution computed for a variant set (`POST …/distribution`). */
  distribution: DistributionResponse | null;
}

const sets = new Map<string, LocalSet>();

export const LOCAL_SET_ID_PREFIX = "localset-";

/** True for a set id minted locally (never issued by the server). */
export function isLocalSetId(setId: string): boolean {
  return setId.startsWith(LOCAL_SET_ID_PREFIX);
}

export function newLocalSetId(): string {
  return `${LOCAL_SET_ID_PREFIX}${crypto.randomUUID()}`;
}

export function putLocalSet(set: LocalSet): void {
  sets.set(set.setId, set);
}

export function requireLocalSet(setId: string): LocalSet {
  const set = sets.get(setId);
  if (!set) {
    throw new Error(
      "This locally generated set is no longer in memory (the page was reloaded). Local sets are " +
        "never persisted — generate again.",
    );
  }
  return set;
}

export function deleteLocalSet(setId: string): void {
  const set = sets.get(setId);
  if (!set) return;
  sets.delete(setId);
}

/** `GET /variant-sets/:id` equivalent. Member tokens are creation-time only, hence null. */
export function localVariantSetResponse(setId: string): VariantSetResponse {
  const set = requireLocalSet(setId);
  return {
    variantSetId: set.setId,
    accessToken: set.accessToken,
    sourceSha256: set.sourceSha256,
    createdAt: set.createdAt,
    variants: set.members.map((member) => {
      const job = getLocalJob(member.jobId);
      return {
        label: member.label,
        jobId: member.jobId,
        accessToken: null,
        status: job ? ("completed" as const) : ("failed" as const),
        errorCode: job ? null : "JOB_NOT_FOUND",
        summary: job?.report.summary ?? null,
      };
    }),
  };
}

/** `GET /student-keyed-sets/:id` equivalent. */
export function localStudentKeyedSetResponse(setId: string): StudentKeyedSetResponse {
  const set = requireLocalSet(setId);
  return {
    setId: set.setId,
    accessToken: set.accessToken,
    sourceSha256: set.sourceSha256,
    createdAt: set.createdAt,
    students: set.members.map((member) => {
      const job = getLocalJob(member.jobId);
      return {
        studentId: member.label,
        key: member.key ?? "",
        jobId: member.jobId,
        accessToken: null,
        status: job ? ("completed" as const) : ("failed" as const),
        errorCode: job ? null : "JOB_NOT_FOUND",
      };
    }),
  };
}

/** Same 52-bit `mod n` reduction the server uses for the seeded strategy. */
function hashModN(input: string, n: number): number {
  return Number(BigInt(`0x${sha256Hex(input).slice(0, 13)}`) % BigInt(n));
}

/** `POST /variant-sets/:id/distribution` equivalent; stores the result for CSV download. */
export function buildLocalDistribution(
  setId: string,
  request: DistributionRequest,
): DistributionResponse {
  const set = requireLocalSet(setId);
  const members = set.members.filter((member) => getLocalJob(member.jobId));
  if (members.length === 0) {
    throw new Error("This variant set has no successfully generated variants to distribute across");
  }

  const distribution = buildDistributionAssignments({
    members: members.map((member) => ({ label: member.label, jobId: member.jobId })),
    studentIds: request.studentIds,
    strategy: request.strategy,
    seed: request.strategy === "seeded_hash" ? (request.seed ?? setId) : null,
    hashModN,
  });

  set.distribution = distribution;
  return distribution;
}

export function localDistributionCsv(setId: string, stem: string): DownloadedFile {
  const set = requireLocalSet(setId);
  if (!set.distribution) {
    throw new Error("No distribution has been generated yet for this variant set");
  }
  return {
    blob: new Blob([distributionToCsv(set.distribution)], { type: "text/csv;charset=utf-8" }),
    filename: `${stem}.distribution.csv`,
  };
}

export function localMappingCsv(setId: string, stem: string): DownloadedFile {
  const set = requireLocalSet(setId);
  const rows = set.members.map((member) => ({
    studentId: member.label,
    key: member.key ?? "",
    jobId: member.jobId,
    outputSha256: getLocalJob(member.jobId)?.manifest.outputFile.sha256 ?? "",
  }));
  return {
    blob: new Blob([mappingToCsv(rows)], { type: "text/csv;charset=utf-8" }),
    filename: `${stem}.mapping.csv`,
  };
}

/**
 * Builds the set's zip archive in the browser with the same `fflate` the server
 * uses: one injected PDF per member plus a combined private manifest.
 */
export function localSetArchive(setId: string, stem: string): DownloadedFile {
  const set = requireLocalSet(setId);
  const files: Record<string, Uint8Array> = {};
  const manifests: Record<string, unknown> = {};
  const safeStem = sanitizeFilenameStem(stem);

  for (const member of set.members) {
    const job = getLocalJob(member.jobId);
    if (!job) continue;
    // Zip-Slip (CWE-22) defense in depth, exactly as the server does: labels
    // and student ids are user-supplied and go into an archive entry name.
    files[`${safeStem}.${sanitizeArchiveSegment(member.label)}.injected.pdf`] = job.outputBytes;
    manifests[member.label] = job.manifest;
  }

  const isVariant = set.kind === "variant";
  files[
    isVariant ? "variant-set.private-manifest.json" : "student-keyed-set.private-manifest.json"
  ] = strToU8(
    JSON.stringify(
      {
        warning: isVariant
          ? "PRIVATE — contains the hidden instruction for every variant. Do not distribute to students."
          : "PRIVATE — contains the hidden instruction and access key for every student. Do not distribute to students.",
        ...(isVariant ? { variantSetId: set.setId } : { setId: set.setId }),
        sourceSha256: set.sourceSha256,
        manifests,
      },
      null,
      2,
    ),
  );

  return {
    blob: new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: "application/zip" }),
    filename: `${safeStem}.${isVariant ? "variant-set" : "student-keyed-set"}.zip`,
  };
}

/** The access token a locally created set reports; member jobs carry the job-level one. */
export function localSetAccessToken(): string {
  return `${LOCAL_JOB_ID_PREFIX}token`;
}
