import { describe, expect, test } from "bun:test";
import { LIMITS } from "../src/limits";

describe("LIMITS", () => {
  test("default limits match the API contract", () => {
    expect(LIMITS.maxFileBytes).toBe(26214400);
    expect(LIMITS.maxPages).toBe(100);
    expect(LIMITS.maxInstructionChars).toBe(1500);
    expect(LIMITS.retentionHours).toBe(24);
    expect(LIMITS.maxPageDimensionPt).toBe(14400);
  });

  test("round 2 limits match the phase3-5 API contract", () => {
    expect(LIMITS.maxVariants).toBe(8);
    expect(LIMITS.maxStudentKeys).toBe(500);
    expect(LIMITS.maxModelTestRepeats).toBe(10);
    expect(LIMITS.maxProcessingMs).toBe(60000);
    expect(LIMITS.maxSubmissionBytes).toBe(10485760);
    expect(LIMITS.maxSubmissionsPerJob).toBe(500);
  });
});
