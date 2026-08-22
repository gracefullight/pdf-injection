/**
 * Server-enforced default limits, configurable via env vars.
 * Source: .agents/results/api-contracts/pdf-injection-jobs-api.md ("Limits" section)
 */
export const LIMITS = {
  /** PDFI_MAX_FILE_BYTES — 25 MB */
  maxFileBytes: 26214400,
  /** PDFI_MAX_PAGES */
  maxPages: 100,
  /** PDFI_MAX_INSTRUCTION_CHARS */
  maxInstructionChars: 1500,
  /** PDFI_RETENTION_HOURS */
  retentionHours: 24,
  /** PDFI_MAX_PAGE_DIMENSION_PT */
  maxPageDimensionPt: 14400,
  /** PDFI_MAX_VARIANTS */
  maxVariants: 8,
  /** PDFI_MAX_STUDENT_KEYS */
  maxStudentKeys: 500,
  /** PDFI_MODEL_TEST_MAX_REPEATS */
  maxModelTestRepeats: 10,
  /** PDFI_MAX_PROCESSING_MS */
  maxProcessingMs: 60000,
  /** Max bytes for a single submission upload (txt/md/pdf/image). */
  maxSubmissionBytes: 10485760,
  /** Max submissions stored per job. */
  maxSubmissionsPerJob: 500,
} as const;

export type Limits = typeof LIMITS;
