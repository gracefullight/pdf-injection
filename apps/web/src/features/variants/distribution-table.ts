import type { DistributionAssignment, DistributionResponse } from "@pdf-injection/contracts";

export interface DistributionRow {
  studentId: string;
  label: string;
  jobId: string;
}

/** Sorts assignments by studentId for stable table rendering. */
export function deriveDistributionRows(
  response: Pick<DistributionResponse, "assignments">,
): DistributionRow[] {
  return [...response.assignments]
    .sort((a, b) => a.studentId.localeCompare(b.studentId))
    .map((assignment) => ({
      studentId: assignment.studentId,
      label: assignment.label,
      jobId: assignment.jobId,
    }));
}

/** Recomputes per-label counts from assignments — used to cross-check the server-provided `counts`. */
export function deriveDistributionCounts(
  assignments: DistributionAssignment[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const assignment of assignments) {
    counts[assignment.label] = (counts[assignment.label] ?? 0) + 1;
  }
  return counts;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Client-side CSV fallback matching the contract's `studentId,label,jobId` shape. */
export function distributionToCsv(rows: DistributionRow[]): string {
  const header = "studentId,label,jobId";
  const lines = rows.map((row) => [row.studentId, row.label, row.jobId].map(csvEscape).join(","));
  return [header, ...lines].join("\n");
}
