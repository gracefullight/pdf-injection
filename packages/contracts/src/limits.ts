/**
 * Server-enforced default limits, configurable via env vars.
 * Source: .agents/results/api-contracts/pdf-injection-jobs-api.md ("Limits" section)
 */
export const LIMITS = {
  /** PS_MAX_FILE_BYTES — 25 MB */
  maxFileBytes: 26214400,
  /** PS_MAX_PAGES */
  maxPages: 100,
  /** PS_MAX_INSTRUCTION_CHARS */
  maxInstructionChars: 1500,
  /** PS_RETENTION_HOURS */
  retentionHours: 24,
  /** PS_MAX_PAGE_DIMENSION_PT */
  maxPageDimensionPt: 14400,
  /** PS_MAX_VARIANTS */
  maxVariants: 8,
  /** PS_MAX_STUDENT_KEYS */
  maxStudentKeys: 500,
  /** PS_MODEL_TEST_MAX_REPEATS */
  maxModelTestRepeats: 10,
  /** PS_MAX_PROCESSING_MS */
  maxProcessingMs: 60000,
  /** Max bytes for a single submission upload (txt/md/pdf/image). */
  maxSubmissionBytes: 10485760,
  /** Max submissions stored per job. */
  maxSubmissionsPerJob: 500,
} as const;

export type Limits = typeof LIMITS;
