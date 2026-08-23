import { createProvider } from "@pdf-injection/benchmark";
import type {
  ExpectedSignal,
  ModelTestProviderSpec,
  ModelTestRun,
  PdfTransform,
  PrivateManifest,
  ProviderName,
  RobustnessExtraction,
  RobustnessPdfResult,
  RobustnessRequest,
  RobustnessRun,
  RobustnessTextResult,
  RobustnessTextSample,
  ScreenshotOcrResult,
  TextTransform,
} from "@pdf-injection/contracts";
import { snapshotPageGeometry } from "@pdf-injection/pdf-engine";
import {
  capabilities,
  evaluateSurvival,
  ocrImage,
  ocrRegenerate,
  printToPdf,
  survivalRate,
  transformText,
} from "@pdf-injection/robustness";
import { extractText, sha256Hex } from "@pdf-injection/validation";
import { PDFDocument } from "pdf-lib";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import type { BackgroundRunner } from "../lib/background-runner";
import { assertJobHasExpectedSignals } from "../lib/expected-signals";
import {
  deleteJobArtifact,
  jobArtifactExists,
  readJobArtifactBytes,
  readJobArtifactText,
  writeJobArtifact,
} from "../lib/job-artifacts";
import type { StoredJobRow } from "../repositories/jobs.repository";
import type { RunsRepository } from "../repositories/runs.repository";
import { readJobFileBytes, readJobFileText } from "../storage";
import { getOllamaStatus, ollamaProviderEnv } from "./ollama-status";

export interface RobustnessServiceDeps {
  config: AppConfig;
  runsRepo: RunsRepository;
  backgroundRunner: BackgroundRunner;
}

interface RunConfigJson {
  pdfTransforms: PdfTransform[];
  textTransforms: TextTransform[];
  textSource: RobustnessRequest["textSource"];
  providers: ModelTestProviderSpec[];
  repeats: number;
  seed?: string;
}

const MAX_TEXT_SOURCE_SAMPLES = 20;

function runFileSegments(runId: string): string[] {
  return ["robustness", `${runId}.json`];
}

function artifactSegments(runId: string, transform: PdfTransform): string[] {
  return ["robustness", runId, `${transform}.pdf`];
}

/**
 * Same gating rules as §2 model-tests (contract §4: "anthropic/openai gated
 * as in §2"), plus round-2 addendum §6: "ollama" is LOCAL — no
 * `allowExternalProviders` gate, no acknowledgement required, only an
 * availability check (cached 10s).
 */
async function assertProvidersAllowed(config: AppConfig, body: RobustnessRequest): Promise<void> {
  for (const provider of body.providers) {
    if (provider.name === "mock") continue;
    if (provider.name === "ollama") {
      const status = await getOllamaStatus(config);
      if (!status.available) {
        throw new ApiError(
          "PROVIDER_NOT_CONFIGURED",
          `Ollama is not reachable at ${config.ollamaBaseUrl}. Set OLLAMA_BASE_URL to point at a running Ollama server.`,
        );
      }
      continue;
    }
    if (!config.allowExternalProviders) {
      throw new ApiError("EXTERNAL_PROVIDERS_DISABLED");
    }
    if (!body.acknowledgeExternalTransfer) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "acknowledgeExternalTransfer must be true to use a non-mock provider (external transfer of text content).",
      );
    }
    const adapter = createProvider({
      name: provider.name,
      model: provider.model,
      env: process.env,
    });
    if (!adapter.isConfigured()) {
      throw new ApiError(
        "PROVIDER_NOT_CONFIGURED",
        `Provider "${provider.name}" has no API key configured on this server.`,
      );
    }
  }
}

async function loadManifest(config: AppConfig, jobId: string): Promise<PrivateManifest> {
  const text = await readJobFileText(config, jobId, "manifest.json");
  return JSON.parse(text) as PrivateManifest;
}

async function resolveTexts(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  textSource: RobustnessRequest["textSource"],
): Promise<string[]> {
  if (textSource.kind === "custom") {
    return textSource.texts.filter((t) => t.trim().length > 0).slice(0, MAX_TEXT_SOURCE_SAMPLES);
  }

  const row = deps.runsRepo.modelTests.findById(textSource.runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError(
      "RUN_NOT_FOUND",
      "textSource.runId does not refer to a model-test run on this job.",
    );
  }
  if (
    !(await jobArtifactExists(deps.config, job.id, ["model-tests", `${textSource.runId}.json`]))
  ) {
    throw new ApiError(
      "RUN_NOT_READY",
      "The referenced model-test run has not finished producing results yet.",
    );
  }
  const text = await readJobArtifactText(deps.config, job.id, [
    "model-tests",
    `${textSource.runId}.json`,
  ]);
  const run = JSON.parse(text) as ModelTestRun;
  const texts = run.results.map((r) => r.rawResponse).filter((t) => t.trim().length > 0);
  return texts.slice(0, MAX_TEXT_SOURCE_SAMPLES);
}

async function extractionFromBytes(
  bytes: Uint8Array,
  manifest: PrivateManifest,
): Promise<RobustnessExtraction> {
  try {
    // No mode-aware comparison target (mirrors job.service.ts's createJob):
    // for unicode_tags, post-transform extraction is expected to always read
    // false for two independent reasons — raster-based transforms
    // (print_to_pdf, ocr_regeneration, screenshot_ocr) destroy the payload
    // outright (no visible glyphs to re-OCR), AND pdfjs-dist's Cf-category
    // filtering means it can never see tag characters even when the payload
    // survives digitally — a valid research finding, mirroring the xmp_only
    // precedent.
    const result = await extractText({
      bytes,
      targetInstruction: manifest.prompt.normalizedInstruction,
      targetPageIndex: manifest.injection.pageIndex,
    });
    return {
      hiddenTextExtracted: result.targetPageMatch || result.anyPageMatch,
      targetPageMatch: result.targetPageMatch,
      anyPageMatch: result.anyPageMatch,
    };
  } catch {
    return { hiddenTextExtracted: false, targetPageMatch: false, anyPageMatch: false };
  }
}

/**
 * Loose geometry check for reporting purposes only (not a hard gate like
 * pdf-engine's `compareGeometry`, which would over-report mismatches here —
 * a rebuilt image-only PDF from `printToPdf`/`ocrRegenerate` legitimately
 * has a fresh MediaBox origin/rotation even when visually "the same size").
 * Compares page count and per-page width/height (rounded to 0.5pt) against
 * the job's own OUTPUT pdf geometry (`report.json`'s `output.pages`).
 */
async function geometryPreservedFor(
  config: AppConfig,
  jobId: string,
  transformedBytes: Uint8Array,
): Promise<boolean | null> {
  try {
    const reportText = await readJobFileText(config, jobId, "report.json");
    const report = JSON.parse(reportText) as {
      output: { pages: Array<{ width: number; height: number }> };
    };
    const doc = await PDFDocument.load(transformedBytes);
    const after = snapshotPageGeometry(doc);
    if (after.length !== report.output.pages.length) return false;
    return after.every((page, i) => {
      const before = report.output.pages[i];
      if (!before) return false;
      return (
        Math.abs(page.width - before.width) <= 0.5 && Math.abs(page.height - before.height) <= 0.5
      );
    });
  } catch {
    return null;
  }
}

async function runPdfTransform(
  config: AppConfig,
  job: StoredJobRow,
  runId: string,
  transform: PdfTransform,
  outputBytes: Uint8Array,
  manifest: PrivateManifest,
): Promise<RobustnessPdfResult> {
  if (transform === "screenshot_ocr") {
    return {
      transform,
      available: false,
      reason:
        "screenshot_ocr runs via POST /jobs/:jobId/robustness/screenshots (upload screenshots directly), not as a pdfTransforms entry.",
      outputSha256: null,
      pageCount: null,
      extraction: null,
      geometryPreserved: null,
    };
  }

  const caps = await capabilities();
  if (transform === "print_to_pdf" && !caps.canvas) {
    return {
      transform,
      available: false,
      reason: caps.reasons.canvas ?? "canvas rendering unavailable on this server",
      outputSha256: null,
      pageCount: null,
      extraction: null,
      geometryPreserved: null,
    };
  }
  if (transform === "ocr_regeneration" && (!caps.canvas || !caps.ocr)) {
    return {
      transform,
      available: false,
      reason: caps.reasons.ocr ?? caps.reasons.canvas ?? "OCR unavailable on this server",
      outputSha256: null,
      pageCount: null,
      extraction: null,
      geometryPreserved: null,
    };
  }

  const result =
    transform === "print_to_pdf" ? await printToPdf(outputBytes) : await ocrRegenerate(outputBytes);
  if (!result.available || !result.bytes) {
    return {
      transform,
      available: false,
      reason: result.reason ?? "transform reported unavailable",
      outputSha256: null,
      pageCount: null,
      extraction: null,
      geometryPreserved: null,
    };
  }

  await writeJobArtifact(config, job.id, artifactSegments(runId, transform), result.bytes);
  const [extraction, geometryPreserved] = await Promise.all([
    extractionFromBytes(result.bytes, manifest),
    geometryPreservedFor(config, job.id, result.bytes),
  ]);

  const pageCount =
    "pageCount" in result && typeof result.pageCount === "number" ? result.pageCount : undefined;
  const ocrConfidence =
    transform === "ocr_regeneration" && "pages" in result && result.pages.length > 0
      ? result.pages.reduce((sum, p) => sum + p.confidence, 0) / result.pages.length
      : undefined;

  return {
    transform,
    available: true,
    outputSha256: sha256Hex(result.bytes),
    pageCount: pageCount ?? null,
    extraction,
    geometryPreserved,
    ...(ocrConfidence !== undefined ? { ocrConfidence } : {}),
  };
}

async function runTextTransform(
  config: AppConfig,
  transform: TextTransform,
  providerSpec: ModelTestProviderSpec | undefined,
  texts: string[],
  repeats: number,
  seed: string | undefined,
  signals: ExpectedSignal[],
): Promise<RobustnessTextResult> {
  const providerName: ProviderName = providerSpec?.name ?? "mock";
  const provider =
    providerName === "mock"
      ? undefined
      : createProvider({
          name: providerName,
          model: providerSpec?.model,
          env: ollamaProviderEnv(config),
        });

  if (texts.length === 0) {
    return {
      transform,
      provider: providerName,
      available: false,
      reason: "No input texts available for this transform.",
      samples: [],
      survivalRate: null,
    };
  }

  const samples: RobustnessTextSample[] = [];
  let anyAvailable = false;
  let reason: string | undefined;

  for (let sampleIndex = 0; sampleIndex < texts.length; sampleIndex++) {
    const text = texts[sampleIndex] as string;
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const sampleSeed = `${seed ?? "pdf-injection"}:sample${sampleIndex}:repeat${repeat}`;
      const outcome = await transformText(transform, text, { seed: sampleSeed, provider });
      if (!outcome.available || outcome.text === null) {
        reason = outcome.reason ?? reason;
        continue;
      }
      anyAvailable = true;
      const survival = evaluateSurvival(signals, text, outcome.text);
      samples.push({
        inputSha256: sha256Hex(text),
        outputSha256: sha256Hex(outcome.text),
        signalsBefore: survival.signalsBefore,
        signalsAfter: survival.signalsAfter,
        allMatchedBefore: survival.allMatchedBefore,
        allMatchedAfter: survival.allMatchedAfter,
      });
    }
  }

  if (!anyAvailable) {
    return {
      transform,
      provider: providerName,
      available: false,
      reason: reason ?? "Transform unavailable.",
      samples: [],
      survivalRate: null,
    };
  }

  return {
    transform,
    provider: providerName,
    available: true,
    samples,
    survivalRate: survivalRate(samples),
  };
}

function buildSummary(
  pdfResults: RobustnessPdfResult[],
  textResults: RobustnessTextResult[],
): string {
  const pdfSummary = pdfResults
    .map(
      (r) =>
        `${r.transform}: ${r.available ? (r.extraction?.hiddenTextExtracted ? "signal survived" : "signal lost") : "unavailable"}`,
    )
    .join("; ");
  const textSummary = textResults
    .map(
      (r) =>
        `${r.transform}(${r.provider}): ${r.available ? `${((r.survivalRate ?? 0) * 100).toFixed(0)}% survival` : "unavailable"}`,
    )
    .join("; ");
  return (
    "Evidence-only robustness report (not a verdict): PDF-channel transforms — " +
    `${pdfSummary || "none run"}. Text-channel transforms — ${textSummary || "none run"}. ` +
    "A transform destroying the injected signal does not mean detection was defeated in general; " +
    "a transform preserving it does not mean detection is reliable in general."
  );
}

async function runRobustnessJob(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  runId: string,
  createdAt: string,
  runConfig: RunConfigJson,
  texts: string[],
  manifest: PrivateManifest,
  signal: AbortSignal,
): Promise<void> {
  const { config, runsRepo } = deps;
  try {
    runsRepo.robustness.updateStatus(runId, "running", null);

    const outputBytes = await readJobFileBytes(config, job.id, "output.pdf");
    const total = runConfig.pdfTransforms.length + runConfig.textTransforms.length;
    let done = 0;

    const pdfResults: RobustnessPdfResult[] = [];
    for (const transform of runConfig.pdfTransforms) {
      if (signal.aborted) {
        runsRepo.robustness.updateStatus(runId, "cancelled", null);
        return;
      }
      pdfResults.push(await runPdfTransform(config, job, runId, transform, outputBytes, manifest));
      done++;
      runsRepo.robustness.updateProgress(runId, done, total);
    }

    const textResults: RobustnessTextResult[] = [];
    for (const transform of runConfig.textTransforms) {
      if (signal.aborted) {
        runsRepo.robustness.updateStatus(runId, "cancelled", null);
        return;
      }
      textResults.push(
        await runTextTransform(
          config,
          transform,
          runConfig.providers[0],
          texts,
          runConfig.repeats,
          runConfig.seed,
          manifest.expectedSignals,
        ),
      );
      done++;
      runsRepo.robustness.updateProgress(runId, done, total);
    }

    const run: RobustnessRun = {
      runId,
      jobId: job.id,
      status: "completed",
      createdAt,
      updatedAt: new Date().toISOString(),
      progress: { done: total, total },
      pdfResults,
      textResults,
      summary: buildSummary(pdfResults, textResults),
      errorCode: null,
    };
    await writeJobArtifact(config, job.id, runFileSegments(runId), JSON.stringify(run, null, 2));
    runsRepo.robustness.updateStatus(runId, "completed", null);
  } catch (err) {
    const errorCode = err instanceof ApiError ? err.code : "INJECTION_FAILED";
    runsRepo.robustness.updateStatus(runId, "failed", errorCode);
    const failedRun: RobustnessRun = {
      runId,
      jobId: job.id,
      status: "failed",
      createdAt,
      updatedAt: new Date().toISOString(),
      progress: { done: 0, total: 0 },
      pdfResults: [],
      textResults: [],
      summary: "This run failed before producing results.",
      errorCode,
    };
    await writeJobArtifact(
      config,
      job.id,
      runFileSegments(runId),
      JSON.stringify(failedRun, null, 2),
    ).catch(() => {});
  }
}

export async function createRobustnessRun(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  body: RobustnessRequest,
): Promise<{ runId: string; status: "queued" }> {
  const { config, runsRepo, backgroundRunner } = deps;

  if (job.status !== "completed") {
    throw new ApiError("JOB_NOT_READY");
  }
  await assertProvidersAllowed(config, body);
  if (!Number.isInteger(body.repeats) || body.repeats < 1) {
    throw new ApiError("VALIDATION_ERROR", "repeats must be a positive integer");
  }

  const manifest = await loadManifest(config, job.id);
  // Text transforms score signal survival; PDF transforms only re-extract the
  // hidden instruction, so a job without signals may still run those.
  if (body.textTransforms.length > 0) assertJobHasExpectedSignals(manifest);
  const texts = await resolveTexts(deps, job, body.textSource);

  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const runConfig: RunConfigJson = {
    pdfTransforms: body.pdfTransforms,
    textTransforms: body.textTransforms,
    textSource: body.textSource,
    providers: body.providers,
    repeats: body.repeats,
    seed: body.seed,
  };

  runsRepo.robustness.insert({
    id: runId,
    jobId: job.id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    configJson: JSON.stringify(runConfig),
    progressDone: 0,
    progressTotal: runConfig.pdfTransforms.length + runConfig.textTransforms.length,
    errorCode: null,
  });

  backgroundRunner.submit(runId, (signal) =>
    runRobustnessJob(deps, job, runId, now, runConfig, texts, manifest, signal),
  );

  return { runId, status: "queued" };
}

export async function listRobustnessRuns(deps: RobustnessServiceDeps, job: StoredJobRow) {
  const rows = deps.runsRepo.robustness.findByJobId(job.id);
  return {
    runs: rows.map((row) => {
      const runConfig = JSON.parse(row.configJson) as RunConfigJson;
      return {
        runId: row.id,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        progress: { done: row.progressDone, total: row.progressTotal },
        pdfTransforms: runConfig.pdfTransforms,
        textTransforms: runConfig.textTransforms,
      };
    }),
  };
}

export async function getRobustnessRun(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  runId: string,
): Promise<RobustnessRun> {
  const { config, runsRepo } = deps;
  const row = runsRepo.robustness.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }
  if (await jobArtifactExists(config, job.id, runFileSegments(runId))) {
    const text = await readJobArtifactText(config, job.id, runFileSegments(runId));
    return JSON.parse(text) as RobustnessRun;
  }
  return {
    runId: row.id,
    jobId: job.id,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    progress: { done: row.progressDone, total: row.progressTotal },
    pdfResults: [],
    textResults: [],
    summary: "This run has not finished yet.",
    errorCode: row.errorCode,
  };
}

export async function getRobustnessArtifact(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  runId: string,
  transform: string,
): Promise<Uint8Array> {
  const { config, runsRepo } = deps;
  const row = runsRepo.robustness.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }
  const validTransforms: PdfTransform[] = ["print_to_pdf", "ocr_regeneration", "screenshot_ocr"];
  if (!(validTransforms as string[]).includes(transform)) {
    throw new ApiError("VALIDATION_ERROR", `Unknown transform: ${transform}`);
  }
  if (
    !(await jobArtifactExists(config, job.id, artifactSegments(runId, transform as PdfTransform)))
  ) {
    throw new ApiError("RUN_NOT_READY");
  }
  return readJobArtifactBytes(config, job.id, artifactSegments(runId, transform as PdfTransform));
}

export async function deleteRobustnessRun(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  runId: string,
): Promise<void> {
  const { config, runsRepo, backgroundRunner } = deps;
  const row = runsRepo.robustness.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }
  backgroundRunner.cancel(runId);
  await deleteJobArtifact(config, job.id, runFileSegments(runId));
  runsRepo.robustness.delete(runId);
}

const MAX_SCREENSHOT_FILES = 20;

export async function analyzeScreenshots(
  deps: RobustnessServiceDeps,
  job: StoredJobRow,
  files: File[],
): Promise<ScreenshotOcrResult> {
  const { config } = deps;
  if (files.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "At least one screenshot file is required.");
  }
  if (files.length > MAX_SCREENSHOT_FILES) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `At most ${MAX_SCREENSHOT_FILES} screenshot files are accepted per request.`,
    );
  }
  for (const file of files) {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      throw new ApiError(
        "UNSUPPORTED_MEDIA_TYPE",
        `Unsupported screenshot type: ${file.type || "unknown"}`,
      );
    }
    if (file.size > config.maxSubmissionBytes) {
      throw new ApiError("FILE_TOO_LARGE");
    }
  }

  const caps = await capabilities();
  if (!caps.ocr) {
    throw new ApiError(
      "OCR_UNAVAILABLE",
      caps.reasons.ocr ?? "OCR is not available on this server.",
    );
  }

  const manifest = await loadManifest(config, job.id);
  const texts: string[] = [];
  const confidences: number[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ocrImage(bytes);
    if (!result.available) {
      throw new ApiError(
        "OCR_UNAVAILABLE",
        result.reason ?? "OCR is not available on this server.",
      );
    }
    texts.push(result.text);
    confidences.push(result.confidence);
  }

  const combinedText = texts.join("\n\n");
  const normalizedInstruction = manifest.prompt.normalizedInstruction.toLowerCase();
  const found =
    normalizedInstruction.length > 0 && combinedText.toLowerCase().includes(normalizedInstruction);
  const ocrConfidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

  return {
    text: combinedText,
    extraction: { hiddenTextExtracted: found, targetPageMatch: found, anyPageMatch: found },
    ocrConfidence,
  };
}
