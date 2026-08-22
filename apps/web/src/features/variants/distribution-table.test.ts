import { describe, expect, it } from "bun:test";
import {
  deriveDistributionCounts,
  deriveDistributionRows,
  distributionToCsv,
} from "@/features/variants/distribution-table";

describe("deriveDistributionRows", () => {
  it("sorts assignments by studentId", () => {
    const rows = deriveDistributionRows({
      assignments: [
        { studentId: "s003", label: "B", jobId: "job-3" },
        { studentId: "s001", label: "A", jobId: "job-1" },
        { studentId: "s002", label: "A", jobId: "job-2" },
      ],
    });
    expect(rows.map((r) => r.studentId)).toEqual(["s001", "s002", "s003"]);
  });
});

describe("deriveDistributionCounts", () => {
  it("counts assignments per label", () => {
    const counts = deriveDistributionCounts([
      { studentId: "s001", label: "A", jobId: "job-1" },
      { studentId: "s002", label: "A", jobId: "job-2" },
      { studentId: "s003", label: "B", jobId: "job-3" },
    ]);
    expect(counts).toEqual({ A: 2, B: 1 });
  });

  it("returns an empty object for no assignments", () => {
    expect(deriveDistributionCounts([])).toEqual({});
  });
});

describe("distributionToCsv", () => {
  it("produces a header + one row per assignment", () => {
    const csv = distributionToCsv([{ studentId: "s001", label: "A", jobId: "job-1" }]);
    expect(csv).toBe("studentId,label,jobId\ns001,A,job-1");
  });

  it("quotes fields containing commas or quotes", () => {
    const csv = distributionToCsv([{ studentId: 's,"001"', label: "A", jobId: "job-1" }]);
    expect(csv).toContain('"s,""001"""');
  });
});
