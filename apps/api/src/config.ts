import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "@pdf-injection/benchmark";
import { LIMITS } from "@pdf-injection/contracts";

/**
 * Server configuration, read from environment variables with the defaults
 * documented in the API contract's "Limits" table. Never hardcode secrets;
 * everything here is either a public default or read from process.env.
 */
export interface AppConfig {
  maxFileBytes: number;
  maxPages: number;
  maxInstructionChars: number;
  retentionHours: number;
  storageDir: string;
  qpdfEnabled: boolean;
  maxPageDimensionPt: number;
  corsOrigin: string;
  sweepIntervalMs: number;
  dbPath: string;
  port: number;
  /** PDFI_RESEARCH_MODE — gates §3 submissions and §4 robustness endpoints. */
  researchMode: boolean;
  /** PDFI_MAX_VARIANTS */
  maxVariants: number;
  /** PDFI_MAX_STUDENT_KEYS */
  maxStudentKeys: number;
  /** Max bytes for a single submission upload (txt/md/pdf/image). */
  maxSubmissionBytes: number;
  /** Max submissions stored per job. */
  maxSubmissionsPerJob: number;
  /** PDFI_ALLOW_EXTERNAL_PROVIDERS — gates anthropic/openai for model-tests + robustness (mock always allowed). */
  allowExternalProviders: boolean;
  /** PDFI_MAX_PROCESSING_MS — per-job processing time limit; exceeding it -> PROCESSING_TIMEOUT (504), no row/files. */
  maxProcessingMs: number;
  /** PDFI_MODEL_TEST_MAX_REPEATS */
  modelTestMaxRepeats: number;
  /** PDFI_MODEL_TEST_CONCURRENCY — bounded parallelism for provider calls within a single model-test run. */
  modelTestConcurrency: number;
  /** PDFI_RESEARCH_RESULTS_DIR — when set, a completed model-test run's export is also copied here (opt-in; default unset). */
  researchResultsDir: string | undefined;
  /** OLLAMA_BASE_URL — base URL of a local Ollama server (round-2 addendum §6). Never gated by allowExternalProviders (local, never leaves the machine). */
  ollamaBaseUrl: string;
  /** PDFI_OLLAMA_MODEL — default model id used when a model-tests/robustness request omits `model` for provider "ollama". */
  ollamaModel: string;
}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`Invalid ${name}="${raw}" (not a number); using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function readBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw !== "true" && raw !== "false") {
    console.warn(
      `Invalid ${name}="${raw}" (expected "true" or "false"); using default ${fallback}`,
    );
    return fallback;
  }
  return raw === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    maxFileBytes: readNumber(env, "PDFI_MAX_FILE_BYTES", LIMITS.maxFileBytes),
    maxPages: readNumber(env, "PDFI_MAX_PAGES", LIMITS.maxPages),
    maxInstructionChars: readNumber(env, "PDFI_MAX_INSTRUCTION_CHARS", LIMITS.maxInstructionChars),
    retentionHours: readNumber(env, "PDFI_RETENTION_HOURS", LIMITS.retentionHours),
    storageDir:
      env.PDFI_STORAGE_DIR && env.PDFI_STORAGE_DIR !== ""
        ? env.PDFI_STORAGE_DIR
        : "./.pdf-injection-data",
    qpdfEnabled: readBoolean(env, "PDFI_QPDF_ENABLED", false),
    maxPageDimensionPt: readNumber(env, "PDFI_MAX_PAGE_DIMENSION_PT", LIMITS.maxPageDimensionPt),
    corsOrigin:
      env.PDFI_CORS_ORIGIN && env.PDFI_CORS_ORIGIN !== ""
        ? env.PDFI_CORS_ORIGIN
        : "http://localhost:5173",
    sweepIntervalMs: readNumber(env, "PDFI_SWEEP_INTERVAL_MS", 10 * 60 * 1000),
    dbPath:
      env.PDFI_DB_PATH && env.PDFI_DB_PATH !== ""
        ? env.PDFI_DB_PATH
        : "./.pdf-injection-data/pdf-injection.sqlite",
    port: readNumber(env, "PDFI_PORT", 3001),
    researchMode: readBoolean(env, "PDFI_RESEARCH_MODE", false),
    maxVariants: readNumber(env, "PDFI_MAX_VARIANTS", LIMITS.maxVariants),
    maxStudentKeys: readNumber(env, "PDFI_MAX_STUDENT_KEYS", LIMITS.maxStudentKeys),
    maxSubmissionBytes: readNumber(env, "PDFI_MAX_SUBMISSION_BYTES", LIMITS.maxSubmissionBytes),
    maxSubmissionsPerJob: readNumber(
      env,
      "PDFI_MAX_SUBMISSIONS_PER_JOB",
      LIMITS.maxSubmissionsPerJob,
    ),
    allowExternalProviders: readBoolean(env, "PDFI_ALLOW_EXTERNAL_PROVIDERS", false),
    maxProcessingMs: readNumber(env, "PDFI_MAX_PROCESSING_MS", LIMITS.maxProcessingMs),
    modelTestMaxRepeats: readNumber(env, "PDFI_MODEL_TEST_MAX_REPEATS", LIMITS.maxModelTestRepeats),
    modelTestConcurrency: readNumber(env, "PDFI_MODEL_TEST_CONCURRENCY", 2),
    researchResultsDir:
      env.PDFI_RESEARCH_RESULTS_DIR && env.PDFI_RESEARCH_RESULTS_DIR !== ""
        ? env.PDFI_RESEARCH_RESULTS_DIR
        : undefined,
    ollamaBaseUrl:
      env.OLLAMA_BASE_URL && env.OLLAMA_BASE_URL !== ""
        ? env.OLLAMA_BASE_URL
        : DEFAULT_OLLAMA_BASE_URL,
    ollamaModel:
      env.PDFI_OLLAMA_MODEL && env.PDFI_OLLAMA_MODEL !== ""
        ? env.PDFI_OLLAMA_MODEL
        : DEFAULT_OLLAMA_MODEL,
  };
}
