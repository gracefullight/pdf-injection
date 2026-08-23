import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { shouldPollRun } from "@/features/robustness/robustness-helpers";
import type { RobustnessRunListItem } from "@/lib/api-robustness";
import { formatDateTime } from "@/lib/format-date";

function transformsSummary(run: RobustnessRunListItem): string {
  const parts = [...run.pdfTransforms, ...run.textTransforms];
  return parts.length > 0 ? parts.join(", ") : "—";
}

export interface RobustnessRunsListProps {
  runs: RobustnessRunListItem[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onDelete: (runId: string) => void;
  deletingRunId: string | null;
}

export function RobustnessRunsList({
  runs,
  selectedRunId,
  onSelect,
  onDelete,
  deletingRunId,
}: RobustnessRunsListProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="robustness-runs-empty">
        No robustness runs yet.
      </p>
    );
  }

  const pendingRun = pendingDeleteId ? runs.find((run) => run.runId === pendingDeleteId) : null;

  return (
    <>
      <Table data-testid="robustness-runs-list">
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Transforms</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.runId} data-testid={`robustness-run-row-${run.runId}`}>
              <TableCell>
                <button
                  type="button"
                  className="cursor-pointer text-primary underline-offset-2 hover:underline"
                  onClick={() => onSelect(run.runId)}
                  data-testid={`robustness-run-select-${run.runId}`}
                >
                  {run.runId.slice(0, 8)}
                </button>
              </TableCell>
              <TableCell>
                <Badge variant={selectedRunId === run.runId ? "default" : "outline"}>
                  {run.status}
                </Badge>
              </TableCell>
              <TableCell>
                {run.progress.done} / {run.progress.total}
              </TableCell>
              <TableCell data-testid={`robustness-run-transforms-${run.runId}`}>
                {transformsSummary(run)}
              </TableCell>
              <TableCell>{formatDateTime(run.createdAt)}</TableCell>
              <TableCell>{formatDateTime(run.updatedAt)}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDeleteId(run.runId)}
                  disabled={deletingRunId === run.runId}
                  data-testid={`robustness-run-delete-${run.runId}`}
                >
                  {deletingRunId === run.runId
                    ? "…"
                    : shouldPollRun(run.status)
                      ? "Cancel"
                      : "Delete"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <ConfirmDialog
        open={pendingRun !== null}
        title={
          pendingRun && shouldPollRun(pendingRun.status)
            ? "Cancel this robustness run?"
            : "Delete this robustness run?"
        }
        description="This permanently removes the run and any downloadable artifacts. This action cannot be undone."
        confirmLabel={
          pendingRun && shouldPollRun(pendingRun.status) ? "Cancel run" : "Delete permanently"
        }
        confirmingLabel="Removing…"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        data-testid="robustness-run-delete-dialog"
        confirmTestId="robustness-run-delete-confirm-button"
      />
    </>
  );
}
