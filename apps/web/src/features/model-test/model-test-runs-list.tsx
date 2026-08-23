import type { ModelTestRunListItem } from "@pdf-injection/contracts";
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
import { shouldPollRun } from "@/features/model-test/model-test-helpers";
import { formatDateTime } from "@/lib/format-date";

export interface ModelTestRunsListProps {
  runs: ModelTestRunListItem[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  onDelete: (runId: string) => void;
  deletingRunId: string | null;
}

export function ModelTestRunsList({
  runs,
  selectedRunId,
  onSelect,
  onDelete,
  deletingRunId,
}: ModelTestRunsListProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="model-test-runs-empty">
        No model test runs yet.
      </p>
    );
  }

  const pendingRun = pendingDeleteId ? runs.find((run) => run.runId === pendingDeleteId) : null;

  return (
    <>
      <Table data-testid="model-test-runs-list">
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.runId} data-testid={`model-test-run-row-${run.runId}`}>
              <TableCell>
                <button
                  type="button"
                  className="cursor-pointer text-primary underline-offset-2 hover:underline"
                  onClick={() => onSelect(run.runId)}
                  data-testid={`model-test-run-select-${run.runId}`}
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
              <TableCell>{formatDateTime(run.createdAt)}</TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingDeleteId(run.runId)}
                  disabled={deletingRunId === run.runId}
                  data-testid={`model-test-run-delete-${run.runId}`}
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
            ? "Cancel this model test run?"
            : "Delete this model test run?"
        }
        description="This permanently removes the run and its results. This action cannot be undone."
        confirmLabel={
          pendingRun && shouldPollRun(pendingRun.status) ? "Cancel run" : "Delete permanently"
        }
        confirmingLabel="Removing…"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        data-testid="model-test-run-delete-dialog"
        confirmTestId="model-test-run-delete-confirm-button"
      />
    </>
  );
}
