import { describe, expect, it } from "bun:test";
import {
  buildLocalDistribution,
  isLocalSetId,
  type LocalSet,
  localDistributionCsv,
  localMappingCsv,
  localVariantSetResponse,
  newLocalSetId,
  putLocalSet,
  requireLocalSet,
} from "@/lib/local-job/local-set-store";

/**
 * The set flows generate one PDF per member, so these tests cover the parts
 * that do NOT need the injection engine: id handling, the API-shaped responses
 * the wizard reads, and the CSV artifacts. The engine-backed path (variants /
 * student-keyed generation, ZIP contents, {{KEY}} substitution) is exercised in
 * a real browser, since it needs pdf.js's worker and a canvas.
 */

function fakeSet(overrides: Partial<LocalSet> = {}): LocalSet {
  return {
    setId: newLocalSetId(),
    kind: "variant",
    accessToken: "local-token",
    sourceFilename: "assignment.pdf",
    sourceSha256: "abc",
    createdAt: "2026-01-01T00:00:00.000Z",
    members: [
      { label: "A", jobId: "local-job-a", key: null },
      { label: "B", jobId: "local-job-b", key: null },
    ],
    distribution: null,
    ...overrides,
  };
}

describe("isLocalSetId", () => {
  it("only matches ids minted locally", () => {
    expect(isLocalSetId(newLocalSetId())).toBe(true);
    expect(isLocalSetId("7f4d1e2c-0000-4000-8000-000000000000")).toBe(false);
  });
});

describe("local set store", () => {
  it("explains that a missing set was lost to a reload", () => {
    expect(() => requireLocalSet("localset-missing")).toThrow(/no longer in memory/);
  });

  it("reports members whose jobs are gone as failed rather than silently dropping them", () => {
    // Member jobs live in the job store; none were registered here, so every
    // member should surface as failed instead of appearing completed.
    const set = fakeSet();
    putLocalSet(set);
    const response = localVariantSetResponse(set.setId);
    expect(response.variantSetId).toBe(set.setId);
    expect(response.variants.map((v) => v.status)).toEqual(["failed", "failed"]);
    expect(response.variants.every((v) => v.accessToken === null)).toBe(true);
  });

  it("refuses to distribute a set whose members have no generated jobs", () => {
    const set = fakeSet();
    putLocalSet(set);
    expect(() =>
      buildLocalDistribution(set.setId, { studentIds: ["s1"], strategy: "round_robin" }),
    ).toThrow(/no successfully generated variants/);
  });

  it("requires a distribution before its CSV can be downloaded", () => {
    const set = fakeSet();
    putLocalSet(set);
    expect(() => localDistributionCsv(set.setId, "assignment")).toThrow(/No distribution/);
  });

  it("builds the mapping CSV from the stored student keys", () => {
    const set = fakeSet({
      kind: "student_keyed",
      members: [
        { label: "alice", jobId: "local-job-1", key: "PLMV9T6V" },
        { label: "bob", jobId: "local-job-2", key: "QRST2345" },
      ],
    });
    putLocalSet(set);

    const file = localMappingCsv(set.setId, "assignment");
    expect(file.filename).toBe("assignment.mapping.csv");
  });

  it("serves a stored distribution back as CSV", async () => {
    const set = fakeSet({
      distribution: {
        strategy: "round_robin",
        seed: null,
        assignments: [{ studentId: "s1", label: "A", jobId: "local-job-a" }],
        counts: { A: 1 },
      },
    });
    putLocalSet(set);

    const file = localDistributionCsv(set.setId, "assignment");
    expect(file.filename).toBe("assignment.distribution.csv");
    expect(await file.blob.text()).toBe("studentId,label,jobId\ns1,A,local-job-a\n");
  });
});
