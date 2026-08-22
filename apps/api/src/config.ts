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
  /** PS_RESEARCH_MODE — gates §3 submissions and §4 robustness endpoints. */
  researchMode: boolean;
  /** PS_MAX_VARIANTS */
  maxVariants: number;
  /** PS_MAX_STUDENT_KEYS */
  maxStudentKeys: number;
  /** Max bytes for a single submission upload (txt/md/pdf/image). */
  maxSubmissionBytes: number;
  /** Max submissions stored per job. */
  maxSubmissionsPerJob: number;
  /** PS_ALLOW_EXTERNAL_PROVIDERS — gates anthropic/openai for model-tests + robustness (mock always allowed). */
  allowExternalProviders: boolean;
  /** PS_MAX_PROCESSING_MS — per-job processing time limit; exceeding it -> PROCESSING_TIMEOUT (504), no row/files. */
  maxProcessingMs: number;
  /** PS_MODEL_TEST_MAX_REPEATS */
  modelTestMaxRepeats: number;
  /** PS_MODEL_TEST_CONCURRENCY — bounded parallelism for provider calls within a single model-test run. */
  modelTestConcurrency: number;
  /** PS_RESEARCH_RESULTS_DIR — when set, a completed model-test run's export is also copied here (opt-in; default unset). */
  researchResultsDir: string | undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`Invalid ${name}="${raw}" (not a number); using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
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
    maxFileBytes: readNumber("PS_MAX_FILE_BYTES", LIMITS.maxFileBytes),
    maxPages: readNumber("PS_MAX_PAGES", LIMITS.maxPages),
    maxInstructionChars: readNumber("PS_MAX_INSTRUCTION_CHARS", LIMITS.maxInstructionChars),
    retentionHours: readNumber("PS_RETENTION_HOURS", LIMITS.retentionHours),
    storageDir:
      env.PS_STORAGE_DIR && env.PS_STORAGE_DIR !== "" ? env.PS_STORAGE_DIR : "./.pdf-injection-data",
    qpdfEnabled: readBoolean("PS_QPDF_ENABLED", false),
    maxPageDimensionPt: readNumber("PS_MAX_PAGE_DIMENSION_PT", LIMITS.maxPageDimensionPt),
    corsOrigin:
      env.PS_CORS_ORIGIN && env.PS_CORS_ORIGIN !== ""
        ? env.PS_CORS_ORIGIN
        : "http://localhost:5173",
    sweepIntervalMs: readNumber("PS_SWEEP_INTERVAL_MS", 10 * 60 * 1000),
    dbPath:
      env.PS_DB_PATH && env.PS_DB_PATH !== ""
        ? env.PS_DB_PATH
        : "./.pdf-injection-data/pdf-injection.sqlite",
    port: readNumber("PS_PORT", 3001),
    researchMode: readBoolean("PS_RESEARCH_MODE", false),
    maxVariants: readNumber("PS_MAX_VARIANTS", LIMITS.maxVariants),
    maxStudentKeys: readNumber("PS_MAX_STUDENT_KEYS", LIMITS.maxStudentKeys),
    maxSubmissionBytes: readNumber("PS_MAX_SUBMISSION_BYTES", LIMITS.maxSubmissionBytes),
    maxSubmissionsPerJob: readNumber("PS_MAX_SUBMISSIONS_PER_JOB", LIMITS.maxSubmissionsPerJob),
    allowExternalProviders: readBoolean("PS_ALLOW_EXTERNAL_PROVIDERS", false),
    maxProcessingMs: readNumber("PS_MAX_PROCESSING_MS", LIMITS.maxProcessingMs),
    modelTestMaxRepeats: readNumber("PS_MODEL_TEST_MAX_REPEATS", LIMITS.maxModelTestRepeats),
    modelTestConcurrency: readNumber("PS_MODEL_TEST_CONCURRENCY", 2),
    researchResultsDir:
      env.PS_RESEARCH_RESULTS_DIR && env.PS_RESEARCH_RESULTS_DIR !== ""
        ? env.PS_RESEARCH_RESULTS_DIR
        : undefined,
  };
}
