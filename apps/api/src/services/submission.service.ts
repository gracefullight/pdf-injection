import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExpectedSignal,
  SubmissionAnalysis,
  SubmissionCalibrationSummary,
  SubmissionInterpretation,
  SubmissionInterpretationHeadline,
  SubmissionLabel,
  SubmissionListResponse,
  SubmissionSignalMatch,
  SubmissionSource,
  SubmissionStatistics,
} from "@pdf-injection/contracts";
import {
  type CalibrateBaselineResult,
  calibrateBaseline,
  compareRates,
  evaluateCandidate,
  holmBonferroni,
  scoreSubmission,
} from "@pdf-injection/detector";
import { ocrImage } from "@pdf-injection/robustness";
import { sha256Hex } from "@pdf-injection/validation";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import { extractFullPdfText } from "../lib/pdf-text";
import type { StoredJobRow } from "../repositories/jobs.repository";
import type { SubmissionsRepository } from "../repositories/submissions.repository";
import { parseAnalysis } from "../repositories/submissions.repository";
import { getPrivateManifest, type JobServiceDeps } from "./job.service";

export interface SubmissionServiceDeps extends JobServiceDeps {
  submissionsRepo: SubmissionsRepository;
}

export interface CreateSubmissionFields {
  file: File | null;
  text: string | null;
  label: string | null;
  acknowledgeNoRealStudentDataRaw: string | null;
}

const TEXT_EXTENSIONS = new Set(["txt", "md"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  // "%PDF-" — pdf-lib/pdfjs tolerate a few bytes of leading garbage, but
  // the contract's magic-byte check just needs to rule out an obviously
  // wrong upload, so a direct prefix check (matching pdf-engine's own
  // inspect-source convention) is sufficient here.
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  return sig.every((b, i) => bytes[i] === b);
}

function hasPngMagic(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return sig.every((b, i) => bytes[i] === b);
}

function hasJpegMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Classifies an uploaded submission file by extension AND magic bytes
 * (contract §3: "txt/md/pdf/png/jpg by magic bytes + extension"). Throws
 * `UNSUPPORTED_MEDIA_TYPE` (415) when either check fails or they disagree.
 */
function classifySubmissionFile(
  filename: string,
  bytes: Uint8Array,
): "txt" | "md" | "pdf" | "image" {
  const ext = extensionOf(filename);
  if (TEXT_EXTENSIONS.has(ext)) return ext as "txt" | "md";
  if (ext === "pdf") {
    if (!hasPdfMagic(bytes))
      throw new ApiError(
        "UNSUPPORTED_MEDIA_TYPE",
        "File extension .pdf does not match its content (magic bytes)",
      );
    return "pdf";
  }
  if (IMAGE_EXTENSIONS.has(ext)) {
    const isPng = hasPngMagic(bytes);
    const isJpeg = hasJpegMagic(bytes);
    if (!isPng && !isJpeg) {
      throw new ApiError(
        "UNSUPPORTED_MEDIA_TYPE",
        "File extension does not match its content (magic bytes)",
      );
    }
    return "image";
  }
  throw new ApiError(
    "UNSUPPORTED_MEDIA_TYPE",
    `Unsupported submission file extension ".${ext}" (allowed: txt, md, pdf, png, jpg)`,
  );
}

interface ExtractionResult {
  text: string;
  source: SubmissionSource;
}

async function extractSubmissionText(
  config: AppConfig,
  fields: CreateSubmissionFields,
): Promise<ExtractionResult> {
  if (fields.file) {
    const bytes = new Uint8Array(await fields.file.arrayBuffer());
    if (bytes.byteLength > config.maxSubmissionBytes) {
      throw new ApiError("FILE_TOO_LARGE");
    }
    const kind = classifySubmissionFile(fields.file.name, bytes);
    if (kind === "txt" || kind === "md") {
      return { text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), source: kind };
    }
    if (kind === "pdf") {
      const text = await extractFullPdfText(bytes);
      return { text, source: "pdf" };
    }
    // image
    const ocr = await ocrImage(bytes);
    if (!ocr.available) {
      throw new ApiError("OCR_UNAVAILABLE", ocr.reason ?? "OCR is not available on this server");
    }
    return { text: ocr.text, source: "image_ocr" };
  }
  if (fields.text !== null && fields.text !== "") {
    if (new TextEncoder().encode(fields.text).byteLength > config.maxSubmissionBytes) {
      throw new ApiError("FILE_TOO_LARGE");
    }
    return { text: fields.text, source: "text" };
  }
  throw new ApiError("VALIDATION_ERROR", "Either a file or a text field is required");
}

function parseLabel(raw: string | null): SubmissionLabel {
  if (raw !== "candidate" && raw !== "baseline") {
    throw new ApiError("VALIDATION_ERROR", 'label must be "candidate" or "baseline"');
  }
  return raw;
}

function parseAcknowledgement(raw: string | null): void {
  if (raw !== "true") {
    throw new ApiError(
      "VALIDATION_ERROR",
      "acknowledgeNoRealStudentData must be true — this MVP must not receive real student work",
    );
  }
}

function submissionsDir(config: AppConfig, jobId: string): string {
  return join(config.storageDir, jobId, "submissions");
}

function submissionTextPath(config: AppConfig, jobId: string, submissionId: string): string {
  return join(submissionsDir(config, jobId), `${submissionId}.txt`);
}

function submissionJsonPath(config: AppConfig, jobId: string, submissionId: string): string {
  return join(submissionsDir(config, jobId), `${submissionId}.json`);
}

function buildInterpretation(
  matchedCount: number,
  total: number,
  calibration: SubmissionAnalysis["calibration"],
): SubmissionInterpretation {
  let headline: SubmissionInterpretationHeadline;
  if (total > 0 && matchedCount === total) {
    headline = "Hidden instruction signal matched";
  } else if (matchedCount > 0) {
    headline = "Behavioral canary detected";
  } else {
    headline = "No consistent signal";
  }

  const text =
    total === 0
      ? "No expected signals are configured for this job, so no evidence could be evaluated."
      : `${matchedCount} of ${total} configured deterministic evidence signal(s) matched in this submission's text.`;

  const alternatives = [
    "The submitter may have independently used the same methodology, phrasing, or structure.",
    "Coincidental phrasing overlap is possible, especially for short or generic signals.",
    "A matched signal is evidence for a human reviewer to inspect, not proof of AI assistance or hidden-instruction compliance.",
  ];

  const uncertainty =
    calibration.baselineCount === 0
      ? "No baseline submissions have been recorded for this job yet, so no false-positive rate is available — treat this result as unvalidated."
      : `Based on ${calibration.baselineCount} baseline submission(s), a false-positive rate of ${
          calibration.baselineFalsePositiveRate !== null
            ? (calibration.baselineFalsePositiveRate * 100).toFixed(1)
            : "n/a"
        }% was observed for "all signals matched"; this is evidence, never a verdict.`;

  return { headline, text, alternatives, uncertainty };
}

async function loadBaselineTexts(
  config: AppConfig,
  submissionsRepo: SubmissionsRepository,
  jobId: string,
  excludeId?: string,
): Promise<string[]> {
  const rows = submissionsRepo
    .findByJobId(jobId)
    .filter((r) => r.label === "baseline" && r.id !== excludeId);
  const texts: string[] = [];
  for (const row of rows) {
    texts.push(await Bun.file(submissionTextPath(config, jobId, row.id)).text());
  }
  return texts;
}

function buildAnalysis(
  submissionId: string,
  jobId: string,
  label: SubmissionLabel,
  createdAt: string,
  text: string,
  source: SubmissionSource,
  signals: ExpectedSignal[],
  calibrationResult: CalibrateBaselineResult,
): SubmissionAnalysis {
  const scored = scoreSubmission(signals, text);
  const evaluated = evaluateCandidate(signals, text, calibrationResult);

  const signalMatches: SubmissionSignalMatch[] = scored.perSignal.map((s) => ({
    signal: s.signal,
    group: s.group,
    matched: s.matched,
    evidence: s.evidence,
    weight: s.weight,
  }));

  const matchedCount = signalMatches.filter((s) => s.matched).length;

  const calibration: SubmissionAnalysis["calibration"] = {
    baselineCount: calibrationResult.baselineCount,
    baselineCombinedScoreMean: calibrationResult.combinedScoreMean,
    baselineFalsePositiveRate: calibrationResult.falsePositiveRate,
    perSignalBaselineRate: calibrationResult.perSignalBaselineRate,
    pValue: evaluated.pValue,
    holmAdjustedPValue: evaluated.holmAdjustedPValue,
    method: evaluated.method,
  };

  return {
    submissionId,
    jobId,
    label,
    createdAt,
    textSha256: sha256Hex(text),
    textLength: text.length,
    source,
    signals: signalMatches,
    scores: evaluated.scores,
    calibration,
    interpretation: buildInterpretation(matchedCount, signals.length, calibration),
  };
}

/** POST /jobs/:jobId/submissions. Requires PS_RESEARCH_MODE. */
export async function createSubmission(
  deps: SubmissionServiceDeps,
  job: StoredJobRow,
  fields: CreateSubmissionFields,
): Promise<SubmissionAnalysis> {
  const { config, submissionsRepo } = deps;

  if (!config.researchMode) {
    throw new ApiError("RESEARCH_MODE_DISABLED");
  }
  parseAcknowledgement(fields.acknowledgeNoRealStudentDataRaw);
  const label = parseLabel(fields.label);

  const existingCount = submissionsRepo.countByJobId(job.id);
  if (existingCount >= config.maxSubmissionsPerJob) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `This job already has the maximum of ${config.maxSubmissionsPerJob} submissions`,
    );
  }

  const { text, source } = await extractSubmissionText(config, fields);

  const { manifest } = await getPrivateManifest(deps, job);
  const signals = manifest.expectedSignals;

  const baselineTexts = await loadBaselineTexts(config, submissionsRepo, job.id);
  const calibrationResult = calibrateBaseline(signals, baselineTexts);

  const submissionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const analysis = buildAnalysis(
    submissionId,
    job.id,
    label,
    createdAt,
    text,
    source,
    signals,
    calibrationResult,
  );

  const dir = submissionsDir(config, job.id);
  await mkdir(dir, { recursive: true });
  await Bun.write(submissionTextPath(config, job.id, submissionId), text);
  await Bun.write(
    submissionJsonPath(config, job.id, submissionId),
    JSON.stringify(analysis, null, 2),
  );

  submissionsRepo.insert({
    id: submissionId,
    jobId: job.id,
    label,
    createdAt,
    textSha256: analysis.textSha256,
    textLength: analysis.textLength,
    source,
    analysisJson: JSON.stringify(analysis),
  });

  return analysis;
}

/**
 * Recomputes calibration + Holm-Bonferroni-adjusted p-values for every
 * submission in a job against its *current* baseline set, persists the
 * refreshed analyses, and returns them (in `findByJobId` order). Called by
 * every GET (list/single/statistics) so results always reflect the job's
 * latest baseline/candidate population, per the round-2 §3 spec.
 */
async function recomputeAndPersist(
  deps: SubmissionServiceDeps,
  jobId: string,
): Promise<Map<string, SubmissionAnalysis>> {
  const { config, submissionsRepo } = deps;
  const rows = submissionsRepo.findByJobId(jobId);
  const job = deps.jobsRepo.findById(jobId);
  if (!job) throw new ApiError("JOB_NOT_FOUND");
  const { manifest } = await getPrivateManifest(deps, job);
  const signals = manifest.expectedSignals;

  const textById = new Map<string, string>();
  for (const row of rows) {
    textById.set(row.id, await Bun.file(submissionTextPath(config, jobId, row.id)).text());
  }

  const baselineTexts = rows.filter((r) => r.label === "baseline").map((r) => textById.get(r.id)!);
  const calibrationResult = calibrateBaseline(signals, baselineTexts);

  const results = new Map<string, SubmissionAnalysis>();
  const candidatePValues: Array<{ id: string; pValue: number }> = [];

  for (const row of rows) {
    const text = textById.get(row.id)!;
    const analysis = buildAnalysis(
      row.id,
      jobId,
      row.label,
      row.createdAt,
      text,
      row.source,
      signals,
      calibrationResult,
    );
    results.set(row.id, analysis);
    if (row.label === "candidate" && analysis.calibration.pValue !== null) {
      candidatePValues.push({ id: row.id, pValue: analysis.calibration.pValue });
    }
  }

  if (candidatePValues.length > 0) {
    const holmResults = holmBonferroni(candidatePValues.map((c) => c.pValue));
    candidatePValues.forEach((c, i) => {
      const analysis = results.get(c.id)!;
      analysis.calibration.holmAdjustedPValue = holmResults[i]!.adjustedP;
    });
  }

  for (const [id, analysis] of results) {
    submissionsRepo.updateAnalysis(id, JSON.stringify(analysis));
  }

  return results;
}

export async function listSubmissions(
  deps: SubmissionServiceDeps,
  job: StoredJobRow,
): Promise<SubmissionListResponse> {
  // Contract §3: the ENTIRE submissions section requires PS_RESEARCH_MODE=true,
  // not just POST. Gated here (and in getSubmission/deleteSubmission) so
  // previously-collected submission data isn't readable/deletable once
  // research mode is turned off — matches this MVP's "must not receive real
  // student data" posture even after the fact. Also gated at the route
  // layer (routes/submissions.ts) as defense in depth.
  if (!deps.config.researchMode) {
    throw new ApiError("RESEARCH_MODE_DISABLED");
  }
  const analysesById = await recomputeAndPersist(deps, job.id);
  const rows = deps.submissionsRepo.findByJobId(job.id);
  const submissions = rows.map((r) => analysesById.get(r.id) ?? parseAnalysis(r));

  const candidates = submissions.filter((s) => s.label === "candidate");
  const baselines = submissions.filter((s) => s.label === "baseline");

  const calibrationSummary: SubmissionCalibrationSummary = {
    baselineCount: baselines.length,
    candidateCount: candidates.length,
    baselineCombinedScoreMean: mean(baselines.map((s) => s.scores.combined)),
    candidateCombinedScoreMean: mean(candidates.map((s) => s.scores.combined)),
  };

  const { manifest } = await getPrivateManifest(deps, job);
  const statistics = compareRates(
    manifest.expectedSignals,
    candidates.map((s) => s.textSha256).length > 0 ? await textsFor(deps, job.id, candidates) : [],
    baselines.length > 0 ? await textsFor(deps, job.id, baselines) : [],
  );

  return { submissions, calibrationSummary, statistics };
}

async function textsFor(
  deps: SubmissionServiceDeps,
  jobId: string,
  analyses: SubmissionAnalysis[],
): Promise<string[]> {
  const texts: string[] = [];
  for (const a of analyses) {
    texts.push(await Bun.file(submissionTextPath(deps.config, jobId, a.submissionId)).text());
  }
  return texts;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export async function getSubmissionStatistics(
  deps: SubmissionServiceDeps,
  job: StoredJobRow,
): Promise<SubmissionStatistics> {
  const { statistics } = await listSubmissions(deps, job);
  return statistics;
}

export async function getSubmission(
  deps: SubmissionServiceDeps,
  job: StoredJobRow,
  submissionId: string,
): Promise<SubmissionAnalysis> {
  if (!deps.config.researchMode) {
    throw new ApiError("RESEARCH_MODE_DISABLED");
  }
  const row = deps.submissionsRepo.findById(submissionId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("SUBMISSION_NOT_FOUND");
  }
  const analysesById = await recomputeAndPersist(deps, job.id);
  return analysesById.get(submissionId) ?? parseAnalysis(row);
}

export async function deleteSubmission(
  deps: SubmissionServiceDeps,
  job: StoredJobRow,
  submissionId: string,
): Promise<void> {
  if (!deps.config.researchMode) {
    throw new ApiError("RESEARCH_MODE_DISABLED");
  }
  const row = deps.submissionsRepo.findById(submissionId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("SUBMISSION_NOT_FOUND");
  }
  deps.submissionsRepo.delete(submissionId);
  await Bun.file(submissionTextPath(deps.config, job.id, submissionId))
    .delete()
    .catch(() => {});
  await Bun.file(submissionJsonPath(deps.config, job.id, submissionId))
    .delete()
    .catch(() => {});
}
