import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MatrixConditionInput } from "@pdf-injection/benchmark";
import {
  ALL_CONDITIONS,
  createProvider,
  DEFAULT_OUTER_PROMPT,
  resolveConditions,
  runMatrix,
  toCsv,
  toJson,
} from "@pdf-injection/benchmark";
import type {
  BenchmarkCondition,
  CreateRunResponse,
  ModelTestProviderSpec,
  ModelTestRequest,
  ModelTestRun,
  ModelTestRunListItem,
  PrivateManifest,
  SmokeTestGate,
} from "@pdf-injection/contracts";
import { PdfEngineError } from "@pdf-injection/pdf-engine";
import { sha256Hex } from "@pdf-injection/validation";
import type { AppConfig } from "../config";
import { ApiError } from "../errors";
import type { BackgroundRunner } from "../lib/background-runner";
import {
  deleteJobArtifact,
  jobArtifactExists,
  readJobArtifactText,
  writeJobArtifact,
} from "../lib/job-artifacts";
import type { StoredJobRow } from "../repositories/jobs.repository";
import type { RunsRepository } from "../repositories/runs.repository";
import { readJobFileText, sanitizeFilenameStem } from "../storage";
import { getConditionPdf } from "./condition-pdfs";
import { getOllamaStatus, ollamaProviderEnv } from "./ollama-status";

export interface ModelTestServiceDeps {
  config: AppConfig;
  runsRepo: RunsRepository;
  backgroundRunner: BackgroundRunner;
}

const EMPTY_SMOKE_TEST_GATE: SmokeTestGate = {
  threshold: 50,
  best: null,
  passed: false,
  positiveControlRate: null,
  originalFalsePositiveRate: null,
  disclosureRateInjected: null,
  variationAcrossRepeats: null,
};

const IN_PROGRESS_INTERPRETATION =
  "This run has not finished yet; results/aggregates below are partial. Poll again once status is completed/failed.";

interface RunConfigJson {
  providers: ModelTestProviderSpec[];
  conditions: BenchmarkCondition[];
  repeats: number;
  outerPrompt: string;
  outerPromptSha256: string;
}

function runFileSegments(runId: string): string[] {
  return ["model-tests", `${runId}.json`];
}

async function loadManifest(config: AppConfig, jobId: string): Promise<PrivateManifest> {
  const text = await readJobFileText(config, jobId, "manifest.json");
  return JSON.parse(text) as PrivateManifest;
}

/**
 * Validates every requested provider against the gating rules (contract §2
 * + round-2 addendum §6): `anthropic`/`openai` need
 * `PDFI_ALLOW_EXTERNAL_PROVIDERS=true` AND `acknowledgeExternalTransfer: true`
 * AND a configured API key; `mock` is always allowed. `ollama` is LOCAL (never
 * leaves the machine) — it skips both the `allowExternalProviders` gate and
 * the `acknowledgeExternalTransfer` requirement entirely, but still needs an
 * availability check (`GET {OLLAMA_BASE_URL}/api/tags`, cached 10s) so an
 * unreachable Ollama server fails fast with 422 `PROVIDER_NOT_CONFIGURED`
 * naming `OLLAMA_BASE_URL` instead of running the whole matrix into a
 * `PROVIDER_ERROR`. Throws the first violation found (order matches the
 * contract's own ordering: disabled -> not acknowledged -> not configured).
 */
async function assertProvidersAllowed(config: AppConfig, body: ModelTestRequest): Promise<void> {
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
        "acknowledgeExternalTransfer must be true to use a non-mock provider (external transfer of PDF content).",
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

async function runModelTestJob(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
  runId: string,
  createdAt: string,
  runConfig: RunConfigJson,
  manifest: PrivateManifest,
  signal: AbortSignal,
): Promise<void> {
  const { config, runsRepo } = deps;
  try {
    runsRepo.modelTests.updateStatus(runId, "running", null);

    const conditionInputs: MatrixConditionInput[] = [];
    for (const condition of runConfig.conditions) {
      if (signal.aborted) {
        runsRepo.modelTests.updateStatus(runId, "cancelled", null);
        return;
      }
      const pdf = await getConditionPdf(config, job.id, condition);
      conditionInputs.push({ condition, pdfBytes: pdf.bytes, pdfSha256: pdf.sha256 });
    }

    if (signal.aborted) {
      runsRepo.modelTests.updateStatus(runId, "cancelled", null);
      return;
    }

    const matrixResult = await runMatrix({
      providers: runConfig.providers,
      conditions: conditionInputs,
      repeats: runConfig.repeats,
      outerPrompt: runConfig.outerPrompt,
      signals: manifest.expectedSignals,
      hiddenInstruction: manifest.prompt.instruction,
      targetPageIndex: manifest.injection.pageIndex,
      concurrency: config.modelTestConcurrency,
      onProgress: (progress) =>
        runsRepo.modelTests.updateProgress(runId, progress.done, progress.total),
      signal,
      env: ollamaProviderEnv(config),
    });

    if (signal.aborted) {
      runsRepo.modelTests.updateStatus(runId, "cancelled", null);
      return;
    }

    const run: ModelTestRun = {
      runId,
      jobId: job.id,
      status: "completed",
      createdAt,
      updatedAt: new Date().toISOString(),
      config: runConfig,
      progress: { done: matrixResult.results.length, total: matrixResult.results.length },
      results: matrixResult.results,
      aggregates: matrixResult.aggregates,
      smokeTestGate: matrixResult.smokeTestGate,
      interpretation: matrixResult.interpretation,
      errorCode: null,
    };

    await writeJobArtifact(config, job.id, runFileSegments(runId), JSON.stringify(run, null, 2));
    runsRepo.modelTests.updateStatus(runId, "completed", null);

    if (config.researchResultsDir) {
      // Opt-in side-channel copy (contract §2: "Also copied into
      // research/results/ ONLY when PDFI_RESEARCH_RESULTS_DIR is set").
      // Best-effort: a failure here must never fail the run itself.
      try {
        await mkdir(config.researchResultsDir, { recursive: true });
        await Bun.write(
          join(config.researchResultsDir, `${job.id}.${runId}.model-tests.json`),
          JSON.stringify(run, null, 2),
        );
      } catch (err) {
        console.error("PDFI_RESEARCH_RESULTS_DIR copy failed:", (err as Error).name);
      }
    }
  } catch (err) {
    // PdfEngineError (e.g. CANVAS_UNAVAILABLE from an image_only condition
    // PDF regenerated via getConditionPdf()) already carries a specific,
    // typed ApiErrorCode — preserve it instead of collapsing every
    // non-ApiError failure into the generic PROVIDER_ERROR bucket.
    const errorCode =
      err instanceof ApiError || err instanceof PdfEngineError ? err.code : "PROVIDER_ERROR";
    runsRepo.modelTests.updateStatus(runId, "failed", errorCode);
    const failedRun: ModelTestRun = {
      runId,
      jobId: job.id,
      status: "failed",
      createdAt,
      updatedAt: new Date().toISOString(),
      config: runConfig,
      progress: { done: 0, total: 0 },
      results: [],
      aggregates: [],
      smokeTestGate: EMPTY_SMOKE_TEST_GATE,
      interpretation: "This run failed before producing results.",
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

export async function createModelTestRun(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
  body: ModelTestRequest,
): Promise<CreateRunResponse> {
  const { config, runsRepo, backgroundRunner } = deps;

  if (job.status !== "completed") {
    throw new ApiError("JOB_NOT_READY");
  }

  await assertProvidersAllowed(config, body);

  if (
    !Number.isInteger(body.repeats) ||
    body.repeats < 1 ||
    body.repeats > config.modelTestMaxRepeats
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `repeats must be an integer between 1 and ${config.modelTestMaxRepeats}`,
    );
  }

  const conditions = resolveConditions(body.conditions);
  if (conditions.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "conditions must resolve to at least one condition");
  }
  for (const c of conditions) {
    if (!(ALL_CONDITIONS as string[]).includes(c)) {
      throw new ApiError("VALIDATION_ERROR", `Unknown condition: ${c}`);
    }
  }

  const outerPrompt =
    body.outerPrompt && body.outerPrompt.trim().length > 0
      ? body.outerPrompt
      : DEFAULT_OUTER_PROMPT;
  const manifest = await loadManifest(config, job.id);

  const totalCalls = body.providers.length * conditions.length * body.repeats;
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  const runConfig: RunConfigJson = {
    providers: body.providers,
    conditions,
    repeats: body.repeats,
    outerPrompt,
    outerPromptSha256: sha256Hex(outerPrompt),
  };

  runsRepo.modelTests.insert({
    id: runId,
    jobId: job.id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    configJson: JSON.stringify(runConfig),
    progressDone: 0,
    progressTotal: totalCalls,
    errorCode: null,
  });

  backgroundRunner.submit(runId, (signal) =>
    runModelTestJob(deps, job, runId, now, runConfig, manifest, signal),
  );

  return { runId, status: "queued", totalCalls };
}

export async function listModelTestRuns(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
): Promise<{ runs: ModelTestRunListItem[] }> {
  const rows = deps.runsRepo.modelTests.findByJobId(job.id);
  const runs: ModelTestRunListItem[] = rows.map((row) => {
    const runConfig = JSON.parse(row.configJson) as RunConfigJson;
    return {
      runId: row.id,
      status: row.status,
      createdAt: row.createdAt,
      progress: { done: row.progressDone, total: row.progressTotal },
      providers: runConfig.providers,
      conditions: runConfig.conditions,
      repeats: runConfig.repeats,
    };
  });
  return { runs };
}

export async function getModelTestRun(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
  runId: string,
): Promise<ModelTestRun> {
  const { config, runsRepo } = deps;
  const row = runsRepo.modelTests.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }

  if (await jobArtifactExists(config, job.id, runFileSegments(runId))) {
    const text = await readJobArtifactText(config, job.id, runFileSegments(runId));
    return JSON.parse(text) as ModelTestRun;
  }

  const runConfig = JSON.parse(row.configJson) as RunConfigJson;
  return {
    runId: row.id,
    jobId: job.id,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    config: runConfig,
    progress: { done: row.progressDone, total: row.progressTotal },
    results: [],
    aggregates: [],
    smokeTestGate: EMPTY_SMOKE_TEST_GATE,
    interpretation: IN_PROGRESS_INTERPRETATION,
    errorCode: row.errorCode,
  };
}

export interface ExportedModelTestRun {
  body: string;
  filename: string;
  contentType: string;
}

export async function exportModelTestRun(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
  runId: string,
  format: "json" | "csv",
  includeRaw: boolean,
): Promise<ExportedModelTestRun> {
  const { config, runsRepo } = deps;
  const row = runsRepo.modelTests.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }
  if (!(await jobArtifactExists(config, job.id, runFileSegments(runId)))) {
    throw new ApiError("RUN_NOT_READY");
  }

  const text = await readJobArtifactText(config, job.id, runFileSegments(runId));
  const run = JSON.parse(text) as ModelTestRun;
  const stem = sanitizeFilenameStem(job.sourceFilename);

  if (format === "csv") {
    return {
      body: toCsv(run, { includeRaw }),
      filename: `${stem}.model-tests.${runId}.csv`,
      contentType: "text/csv",
    };
  }
  return {
    body: toJson(run),
    filename: `${stem}.model-tests.${runId}.json`,
    contentType: "application/json",
  };
}

export async function deleteModelTestRun(
  deps: ModelTestServiceDeps,
  job: StoredJobRow,
  runId: string,
): Promise<void> {
  const { config, runsRepo, backgroundRunner } = deps;
  const row = runsRepo.modelTests.findById(runId);
  if (!row || row.jobId !== job.id) {
    throw new ApiError("RUN_NOT_FOUND");
  }
  backgroundRunner.cancel(runId);
  await deleteJobArtifact(config, job.id, runFileSegments(runId));
  runsRepo.modelTests.delete(runId);
}
