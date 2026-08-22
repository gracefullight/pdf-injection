import type { SubmissionAnalysis, SubmissionLabel } from "@pdf-injection/contracts";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format-date";

export interface SubmissionsListProps {
  submissions: SubmissionAnalysis[];
  selectedId: string | null;
  onSelect: (submissionId: string) => void;
  onDelete: (submissionId: string) => void;
  deletingId: string | null;
}

type LabelFilter = "all" | SubmissionLabel;

/** List + label filter + delete for a job's stored submissions. */
export function SubmissionsList({
  submissions,
  selectedId,
  onSelect,
  onDelete,
  deletingId,
}: SubmissionsListProps) {
  const [filter, setFilter] = useState<LabelFilter>("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const filtered = filter === "all" ? submissions : submissions.filter((s) => s.label === filter);

  return (
    <div className="flex flex-col gap-3" data-testid="submissions-list">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Filter:</span>
        <Select value={filter} onValueChange={(value) => setFilter(value as LabelFilter)}>
          <SelectTrigger className="w-44" data-testid="submissions-filter-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="candidate">Candidate</SelectItem>
            <SelectItem value="baseline">Baseline</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {filtered.length} of {submissions.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="submissions-empty-state">
          No submissions {filter !== "all" ? `with label "${filter}"` : "yet"}. Add at least 3
          baseline texts to calibrate a false-positive rate before drawing conclusions from
          candidate submissions.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Headline</TableHead>
              <TableHead>Combined</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((submission) => (
              <TableRow
                key={submission.submissionId}
                data-testid={`submissions-row-${submission.submissionId}`}
                className={submission.submissionId === selectedId ? "bg-secondary/60" : undefined}
              >
                <TableCell>
                  <Badge variant={submission.label === "candidate" ? "default" : "secondary"}>
                    {submission.label}
                  </Badge>
                </TableCell>
                <TableCell>{submission.source}</TableCell>
                <TableCell className="text-xs">{submission.interpretation.headline}</TableCell>
                <TableCell>{Math.round(submission.scores.combined * 100)}%</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateTime(submission.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onSelect(submission.submissionId)}
                      data-testid={`submissions-open-${submission.submissionId}`}
                    >
                      View
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete submission ${submission.submissionId}`}
                      onClick={() => setPendingDeleteId(submission.submissionId)}
                      disabled={deletingId === submission.submissionId}
                      data-testid={`submissions-delete-${submission.submissionId}`}
                    >
                      {deletingId === submission.submissionId ? (
                        "Deleting…"
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this submission?"
        description="This permanently removes the submission and its analysis. This action cannot be undone."
        confirmLabel="Delete permanently"
        confirmingLabel="Deleting…"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) onDelete(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        data-testid="submissions-delete-dialog"
        confirmTestId="submissions-delete-confirm-button"
      />
    </div>
  );
}
