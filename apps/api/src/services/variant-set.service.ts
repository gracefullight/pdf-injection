import { mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { JobStatus, VariantJobSummary, VariantSetResponse } from "@pdf-injection/contracts";
import {
  buildDistributionAssignments,
  distributionToCsv as distributionRowsToCsv,
  parseVariantSpecs,
  type VariantSpec,
} from "@pdf-injection/contracts";
import { sha256Hex } from "@pdf-injection/validation";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { buildZip, jsonZipEntry, type ZipEntry } from "../lib/zip";
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
  getPrivateManifest,
} from "./job.service";

export interface VariantSetServiceDeps {
  config: AppConfig;
  jobsRepo: JobsRepository;
  variantSetsRepo: VariantSetsRepository;
}

export interface CreateVariantSetFields {
  file: File;
  variantsJson: string;
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

/** Per-variant outcome recorded in `variant_sets.meta_json` (canonical list, including pre-processing failures that never got a job row). */
interface MetaVariantEntry {
  label: string;
  jobId: string; // "" when no job was ever created (pre-processing rejection)
  status: JobStatus;
  errorCode: string | null;
}

interface SetMeta {
  sourceFilename: string;
  variants: MetaVariantEntry[];
}

function parseVariants(json: string, maxVariants: number): VariantSpec[] {
  try {
    return parseVariantSpecs(json, maxVariants);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/limit is/.test(message)) {
      throw new ApiError("TOO_MANY_VARIANTS", message);
    }
    throw new ApiError("VALIDATION_ERROR", message);
  }
}

function toVariantJobSummary(
  entry: MetaVariantEntry,
  accessToken: string | null,
): VariantJobSummary {
  return {
    label: entry.label,
    jobId: entry.jobId,
    // null (not "") once a member's token isn't being freshly returned —
    // an empty string could be mistaken for a usable (if useless) token;
    // null makes "no token here" unambiguous. See UX C-02: the set's own
    // token now authorizes reads against every member job directly, so the
    // frontend doesn't need this field on GET at all.
    accessToken,
    status: entry.status,
    errorCode: entry.errorCode,
  };
}

export async function createVariantSet(
  deps: VariantSetServiceDeps,
  fields: CreateVariantSetFields,
): Promise<VariantSetResponse> {
  const { config, jobsRepo, variantSetsRepo } = deps;

  const variants = parseVariants(fields.variantsJson, config.maxVariants);

  const sourceBytes = new Uint8Array(await fields.file.arrayBuffer());
  const sourceSha256 = sha256Hex(sourceBytes);

  const variantSetId = crypto.randomUUID();
  const setAccessToken = generateAccessToken();
  const setAccessTokenHash = hashAccessToken(setAccessToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.retentionHours * 60 * 60 * 1000);

  const metaVariants: MetaVariantEntry[] = [];
  const responseVariants: VariantJobSummary[] = [];

  for (const variant of variants) {
    const jobFields: CreateJobFields = {
      file: fields.file,
      instruction: variant.instruction,
      expectedSignalsJson: JSON.stringify(variant.expectedSignals),
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
      jobsRepo.setSetId(result.jobId, variantSetId);
      variantSetsRepo.insertMember({
        setId: variantSetId,
        labelOrStudentId: variant.label,
        jobId: result.jobId,
        keyOrNull: null,
      });
      metaVariants.push({
        label: variant.label,
        jobId: result.jobId,
        status: result.status,
        errorCode: result.errorCode,
      });
      responseVariants.push(
        toVariantJobSummary(metaVariants[metaVariants.length - 1]!, result.accessToken),
      );
    } catch (err) {
      // Pre-processing rejection (e.g. PROMPT_LINT_ERROR for this variant's
      // instruction) — createJob() throws before any job row/files exist.
      // Per contract: "partial failures reported per variant" rather than
      // failing the whole request. No jobId exists to report; jobId: "" is
      // the documented sentinel (never a valid job id, and never resolvable
      // via GET /jobs/:jobId).
      const code = err instanceof ApiError ? err.code : "INJECTION_FAILED";
      metaVariants.push({ label: variant.label, jobId: "", status: "failed", errorCode: code });
      responseVariants.push(toVariantJobSummary(metaVariants[metaVariants.length - 1]!, null));
    }
  }

  const meta: SetMeta = { sourceFilename: fields.file.name, variants: metaVariants };

  variantSetsRepo.insertSet({
    id: variantSetId,
    kind: "variant",
    accessTokenHash: setAccessTokenHash,
    sourceSha256,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metaJson: JSON.stringify(meta),
  });

  return {
    variantSetId,
    accessToken: setAccessToken,
    sourceSha256,
    createdAt: now.toISOString(),
    variants: responseVariants,
  };
}

export async function getVariantSet(
  deps: VariantSetServiceDeps,
  setId: string,
): Promise<VariantSetResponse> {
  const { config, variantSetsRepo } = deps;
  const set = variantSetsRepo.findById(setId);
  if (set?.kind !== "variant") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const meta = JSON.parse(set.metaJson) as SetMeta;

  const variants: VariantJobSummary[] = [];
  for (const entry of meta.variants) {
    if (entry.jobId === "") {
      variants.push(toVariantJobSummary(entry, null));
      continue;
    }
    const job = deps.jobsRepo.findById(entry.jobId);
    if (!job) {
      // Member job was independently deleted (shouldn't normally happen
      // outside of a set-level delete, which removes the whole set) —
      // fall back to the last-known meta entry rather than throwing.
      variants.push(toVariantJobSummary(entry, null));
      continue;
    }
    const status = await getJobStatus({ config, jobsRepo: deps.jobsRepo }, job);
    variants.push({
      label: entry.label,
      jobId: job.id,
      accessToken: null, // only returned once, at creation time (UX C-02: use the set's own token instead)
      status: status.status,
      errorCode: status.errorCode,
      summary: status.summary,
    });
  }

  return {
    variantSetId: set.id,
    accessToken: "",
    sourceSha256: set.sourceSha256,
    createdAt: set.createdAt,
    variants,
  };
}

export interface DistributionResult {
  strategy: "round_robin" | "seeded_hash";
  seed: string | null;
  assignments: Array<{ studentId: string; label: string; jobId: string }>;
  counts: Record<string, number>;
}

function hashModN(input: string, n: number): number {
  const hex = sha256Hex(input);
  // Use the first 13 hex chars (52 bits) as an unbiased-enough BigInt source
  // for `mod n` with n bounded by maxVariants (<=8) / maxStudentKeys (<=500).
  const big = BigInt(`0x${hex.slice(0, 13)}`);
  return Number(big % BigInt(n));
}

export async function buildDistribution(
  deps: VariantSetServiceDeps,
  setId: string,
  studentIds: string[],
  strategy: "round_robin" | "seeded_hash",
  seed: string | undefined,
): Promise<DistributionResult> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "variant") throw new ApiError("VARIANT_SET_NOT_FOUND");

  const members = deps.variantSetsRepo.findMembers(setId).filter((m) => m.jobId !== "");
  if (members.length === 0) {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Variant set has no successfully created variants to distribute across",
    );
  }
  const resolvedSeed = strategy === "seeded_hash" ? (seed ?? setId) : null;

  // Shared with apps/web's on-device set flow so both produce identical
  // assignments for the same inputs — see @pdf-injection/contracts src/sets.ts.
  const distribution: DistributionResult = buildDistributionAssignments({
    members: members.map((m) => ({ label: m.labelOrStudentId, jobId: m.jobId })),
    studentIds,
    strategy,
    seed: resolvedSeed,
    hashModN,
  });

  const filePath = distributionFilePath(deps.config, setId);
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(distribution, null, 2));
  return distribution;
}

/** GET /variant-sets/:id/distribution — reads back the last POSTed distribution.json. */
export async function getDistribution(
  deps: VariantSetServiceDeps,
  setId: string,
): Promise<DistributionResult> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "variant") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const file = Bun.file(distributionFilePath(deps.config, setId));
  if (!(await file.exists())) {
    throw new ApiError(
      "JOB_NOT_READY",
      "No distribution has been generated yet for this variant set",
    );
  }
  return JSON.parse(await file.text()) as DistributionResult;
}

export function distributionToCsv(distribution: DistributionResult): string {
  return distributionRowsToCsv(distribution);
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function setDir(config: AppConfig, setId: string): string {
  return `${config.storageDir}/sets/${setId}`;
}

function distributionFilePath(config: AppConfig, setId: string): string {
  return `${setDir(config, setId)}/distribution.json`;
}

export async function buildVariantSetArchive(
  deps: VariantSetServiceDeps,
  setId: string,
): Promise<Uint8Array> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "variant") throw new ApiError("VARIANT_SET_NOT_FOUND");
  const members = deps.variantSetsRepo.findMembers(setId).filter((m) => m.jobId !== "");
  const meta = JSON.parse(set.metaJson) as SetMeta;
  const stem = sanitizeFilenameStem(meta.sourceFilename);

  const entries: ZipEntry[] = [];
  const manifests: Record<string, unknown> = {};

  for (const member of members) {
    const job = deps.jobsRepo.findById(member.jobId);
    if (!job) continue;
    if (job.status === "completed") {
      const { bytes } = await getOutputPdf({ config: deps.config, jobsRepo: deps.jobsRepo }, job);
      // CWE-22 (Zip Slip) fix: labelOrStudentId is user-supplied (variant
      // label) and only length-validated at the schema level (minLength: 1)
      // — sanitize before it's embedded in a zip entry path. lib/zip.ts's
      // buildZip() independently rejects any residual path separator too.
      entries.push({
        path: `${stem}.${sanitizeArchiveSegment(member.labelOrStudentId)}.injected.pdf`,
        data: bytes,
      });
    }
    try {
      const { manifest } = await getPrivateManifest(
        { config: deps.config, jobsRepo: deps.jobsRepo },
        job,
      );
      manifests[member.labelOrStudentId] = manifest;
    } catch {
      // JOB_NOT_READY (e.g. failed job with no manifest) — omit this label's manifest.
    }
  }

  entries.push(
    jsonZipEntry("variant-set.private-manifest.json", {
      warning:
        "PRIVATE — contains the hidden instruction for every variant. Do not distribute to students.",
      variantSetId: set.id,
      sourceSha256: set.sourceSha256,
      manifests,
    }),
  );

  return buildZip(entries);
}

/** Shared cascade body for deleteVariantSet / deleteStudentKeyedSet / sweepExpiredSets: every member job (files + row) + the set's own storage dir + the set row. Kind-agnostic — the caller is responsible for any kind check. */
async function cascadeDeleteSet(deps: VariantSetServiceDeps, setId: string): Promise<void> {
  const members = deps.variantSetsRepo.findMembers(setId);
  for (const member of members) {
    if (member.jobId === "") continue;
    await deleteJob({ config: deps.config, jobsRepo: deps.jobsRepo }, member.jobId);
  }
  await rm(setDir(deps.config, setId), { recursive: true, force: true });
  deps.variantSetsRepo.deleteSet(setId);
}

/** DELETE /variant-sets/:id cascade: every member job (files + row) + the set row. */
export async function deleteVariantSet(deps: VariantSetServiceDeps, setId: string): Promise<void> {
  const set = deps.variantSetsRepo.findById(setId);
  if (set?.kind !== "variant") throw new ApiError("VARIANT_SET_NOT_FOUND");
  await cascadeDeleteSet(deps, setId);
}

/**
 * Retention sweep for variant-sets AND student-keyed sets (same table,
 * `kind`-agnostic): mirrors job.service.ts's `sweepExpiredJobs`, called
 * from the same unref'd interval in index.ts. A set's `expires_at` is set
 * once at creation (same retentionHours as a plain job) and never
 * refreshed by member-job activity, so this independently catches sets
 * whose member jobs haven't individually expired yet but whose OWN
 * `distribution.json` / `mapping.json` set-level storage would otherwise
 * be orphaned if only `sweepExpiredJobs` ran.
 */
export async function sweepExpiredSets(deps: VariantSetServiceDeps): Promise<number> {
  const expired = deps.variantSetsRepo.findExpired(new Date().toISOString());
  for (const set of expired) {
    await cascadeDeleteSet(deps, set.id);
  }
  return expired.length;
}
