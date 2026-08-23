import { describe, expect, test } from "bun:test";
import {
  buildDistributionAssignments,
  csvField,
  distributionToCsv,
  mappingToCsv,
  sanitizeArchiveSegment,
  sanitizeFilenameStem,
  substituteKey,
  substituteSignalKeys,
} from "../src/sets";
import type { ExpectedSignal } from "../src/types";

/**
 * These helpers are shared by `apps/api`'s set services and `apps/web`'s
 * on-device set flow, so a change here changes both — hence the assertions on
 * exact output (CSV bytes, archive-entry names, assignment order) rather than
 * just shape.
 */

const MEMBERS = [
  { label: "B", jobId: "job-b" },
  { label: "A", jobId: "job-a" },
  { label: "C", jobId: "job-c" },
];

describe("buildDistributionAssignments", () => {
  test("round_robin walks labels in sorted order over sorted student ids", () => {
    const result = buildDistributionAssignments({
      members: MEMBERS,
      studentIds: ["s3", "s1", "s2", "s4"],
      strategy: "round_robin",
      seed: null,
      hashModN: () => 0,
    });

    expect(result.assignments).toEqual([
      { studentId: "s1", label: "A", jobId: "job-a" },
      { studentId: "s2", label: "B", jobId: "job-b" },
      { studentId: "s3", label: "C", jobId: "job-c" },
      { studentId: "s4", label: "A", jobId: "job-a" },
    ]);
    expect(result.counts).toEqual({ A: 2, B: 1, C: 1 });
  });

  test("seeded_hash is deterministic for the same seed and independent of input order", () => {
    const hashModN = (input: string, n: number) => input.length % n;
    const first = buildDistributionAssignments({
      members: MEMBERS,
      studentIds: ["s1", "s2", "s3"],
      strategy: "seeded_hash",
      seed: "exam-2026",
      hashModN,
    });
    const shuffled = buildDistributionAssignments({
      members: [...MEMBERS].reverse(),
      studentIds: ["s3", "s1", "s2"],
      strategy: "seeded_hash",
      seed: "exam-2026",
      hashModN,
    });

    expect(shuffled.assignments).toEqual(first.assignments);
    expect(first.seed).toBe("exam-2026");
  });

  test("every label appears in counts even when no student is assigned to it", () => {
    const result = buildDistributionAssignments({
      members: MEMBERS,
      studentIds: ["only-one"],
      strategy: "round_robin",
      seed: null,
      hashModN: () => 0,
    });
    expect(Object.keys(result.counts).sort()).toEqual(["A", "B", "C"]);
    expect(result.counts.B).toBe(0);
  });
});

describe("csv", () => {
  test("quotes only values containing a comma, quote or newline", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });

  test("distributionToCsv emits a header and one row per assignment", () => {
    const csv = distributionToCsv({
      strategy: "round_robin",
      seed: null,
      assignments: [{ studentId: "s,1", label: "A", jobId: "job-a" }],
      counts: { A: 1 },
    });
    expect(csv).toBe('studentId,label,jobId\n"s,1",A,job-a\n');
  });

  test("mappingToCsv emits the private student-id/key mapping", () => {
    const csv = mappingToCsv([
      { studentId: "alice", key: "PLMV9T6V", jobId: "job-1", outputSha256: "abc" },
    ]);
    expect(csv).toBe("studentId,key,jobId,outputSha256\nalice,PLMV9T6V,job-1,abc\n");
  });
});

describe("key substitution", () => {
  test("replaces every {{KEY}} occurrence", () => {
    expect(substituteKey("a {{KEY}} b {{KEY}}", "XYZ")).toBe("a XYZ b XYZ");
  });

  test("substitutes inside exact_phrase signals and leaves other types untouched", () => {
    const signals: ExpectedSignal[] = [
      { type: "exact_phrase", value: "code {{KEY}}", caseSensitive: true },
      { type: "ordered_terms", values: ["{{KEY}}"] },
    ];
    const result = substituteSignalKeys(signals, "ABC123");
    expect(result[0]).toEqual({ type: "exact_phrase", value: "code ABC123", caseSensitive: true });
    // Non-text signal types carry no free-text key placeholder to substitute.
    expect(result[1]).toEqual(signals[1]);
  });
});

describe("filename sanitization", () => {
  test("stem drops the extension and replaces unsafe characters", () => {
    expect(sanitizeFilenameStem("과제 (최종).pdf")).toBe("_______");
    expect(sanitizeFilenameStem("report.v2.pdf")).toBe("report.v2");
    expect(sanitizeFilenameStem(".pdf")).toBe("document");
  });

  test("archive segments cannot introduce a path or a leading dot", () => {
    // Leading dots collapse to a single "_", then the rest is character-replaced.
    expect(sanitizeArchiveSegment("../../etc/passwd")).toBe("__.._etc_passwd");
    expect(sanitizeArchiveSegment("a/b")).toBe("a_b");
    expect(sanitizeArchiveSegment("")).toBe("item");
    expect(sanitizeArchiveSegment("x".repeat(100)).length).toBe(64);
  });
});
