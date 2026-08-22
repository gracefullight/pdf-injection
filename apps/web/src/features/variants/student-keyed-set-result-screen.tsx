import type { StudentKeyedSetResponse } from "@pdf-injection/contracts";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OverallBadge } from "@/features/validation-result/overall-badge";
import { type SetMember, SetMemberDialog } from "@/features/variants/set-member-dialog";
import { getJobStatus, triggerBrowserDownload } from "@/lib/api";
import {
  deleteStudentKeyedSet,
  downloadMappingCsv,
  downloadStudentKeyedSetArchive,
  getStudentKeyedSet,
} from "@/lib/api-variant-sets";
import { ResearchApiError } from "@/lib/research-fetch";

export interface StudentKeyedSetResultScreenProps {
  setId: string;
  accessToken: string;
  sourceStem: string;
  onDeleted: () => void;
  onStartOver: () => void;
}

const JOB_STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  completed: "success",
  processing: "warning",
  queued: "secondary",
  failed: "destructive",
};

/**
 * `StudentOverallCell` fires its own `GET /jobs/:jobId` per completed row —
 * with `maxStudentKeys` up to 500 (contract §0.1 `LIMITS`), mounting every
 * row at once would fan out up to 500 concurrent requests. Only the first
 * `PAGE_SIZE` rows are rendered (and therefore queried) at a time, with a
 * "Load more" button to reveal the rest — QA result-qa-r7 MEDIUM 4.
 */
const PAGE_SIZE = 20;

function hasPendingMember(data: StudentKeyedSetResponse | undefined): boolean {
  return (data?.students ?? []).some(
    (student) => student.status === "queued" || student.status === "processing",
  );
}

/**
 * `StudentKeySummary` (contract §1) carries `status` but not a `summary` —
 * unlike variant sets, so overall PASS/FAIL is fetched per row via the
 * member job's own `GET /jobs/:jobId` (already exported from `api.ts`),
 * lazily once that job is `completed`.
 */
function StudentOverallCell({
  jobId,
  accessToken,
  setAccessToken,
  status,
}: {
  jobId: string;
  /** The member job's own token, if the server still returns one. Falls back to `setAccessToken` — see C-02 fix note on `SetMemberDialog`. */
  accessToken: string | null;
  setAccessToken: string;
  status: string;
}) {
  const overallQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => getJobStatus(jobId, accessToken || setAccessToken),
    enabled: status === "completed",
  });
  const overall = overallQuery.data?.summary?.overall ?? null;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <OverallBadge status={overall} />
      {/* Same fix as variant-set-result-screen.tsx's per-row caption — the API returns the
       * literal string "NOT_TESTED", not null/undefined, so a falsy check never matched
       * (M-10 cycle 3 residual). */}
      {(overall === null || overall === "NOT_TESTED") && status === "completed" && (
        <span className="text-xs text-muted-foreground">Not run: open to validate</span>
      )}
    </div>
  );
}

/** Step 4 result screen for `distributionMode: "student_keyed"` — per-student table, mapping (private), archive, delete. */
export function StudentKeyedSetResultScreen({
  setId,
  accessToken,
  sourceStem,
  onDeleted,
  onStartOver,
}: StudentKeyedSetResultScreenProps) {
  const [openMember, setOpenMember] = useState<SetMember | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [downloadingMapping, setDownloadingMapping] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const setQuery = useQuery({
    queryKey: ["student-keyed-set", setId],
    queryFn: () => getStudentKeyedSet(setId, accessToken),
    refetchInterval: (query) => (hasPendingMember(query.state.data) ? 1000 : false),
  });

  async function handleDownloadArchive() {
    setDownloadingArchive(true);
    setDownloadError(null);
    try {
      triggerBrowserDownload(await downloadStudentKeyedSetArchive(setId, accessToken, sourceStem));
    } catch (error) {
      setDownloadError(
        error instanceof ResearchApiError ? error.message : "Could not download the archive.",
      );
    } finally {
      setDownloadingArchive(false);
    }
  }

  async function handleDownloadMapping() {
    setDownloadingMapping(true);
    setDownloadError(null);
    try {
      triggerBrowserDownload(await downloadMappingCsv(setId, accessToken, sourceStem));
    } catch (error) {
      setDownloadError(
        error instanceof ResearchApiError ? error.message : "Could not download the mapping.",
      );
    } finally {
      setDownloadingMapping(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteStudentKeyedSet(setId, accessToken);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  if (setQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading student-keyed set…</p>;
  }

  if (setQuery.isError || !setQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load student-keyed set</AlertTitle>
        <AlertDescription>
          {setQuery.error instanceof ResearchApiError
            ? setQuery.error.message
            : "Unexpected error."}
        </AlertDescription>
      </Alert>
    );
  }

  const data = setQuery.data;
  const visibleStudents = data.students.slice(0, visibleCount);
  const remainingCount = data.students.length - visibleStudents.length;

  return (
    <div className="flex flex-col gap-6" data-testid="student-keyed-set-result-screen">
      <div>
        <h2 className="text-xl font-semibold text-foreground">4. Validate: student-keyed set</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.students.length} students, each with a unique embedded key.
        </p>
      </div>

      <Alert variant="destructive" data-testid="student-keyed-mapping-warning">
        <ShieldAlert />
        <AlertTitle>PRIVATE: student id ↔ key mapping</AlertTitle>
        <AlertDescription>
          The student id ↔ key mapping is only available as a download below. Do not distribute it
          to students.
        </AlertDescription>
      </Alert>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student id</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Client validation</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleStudents.map((student) => (
            <TableRow
              key={student.studentId}
              data-testid={`student-keyed-row-${student.studentId}`}
            >
              <TableCell className="font-medium">{student.studentId}</TableCell>
              <TableCell>
                <Badge variant={JOB_STATUS_VARIANT[student.status] ?? "secondary"}>
                  {student.status}
                </Badge>
              </TableCell>
              <TableCell>
                <StudentOverallCell
                  jobId={student.jobId}
                  accessToken={student.accessToken}
                  setAccessToken={accessToken}
                  status={student.status}
                />
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOpenMember({
                      jobId: student.jobId,
                      accessToken: student.accessToken,
                      label: student.studentId,
                    })
                  }
                  disabled={student.status !== "completed"}
                  data-testid={`student-keyed-open-${student.studentId}`}
                >
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {remainingCount > 0 && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
            data-testid="student-keyed-load-more-button"
          >
            Load more ({remainingCount} remaining)
          </Button>
        </div>
      )}

      {downloadError && (
        <Alert variant="destructive">
          <AlertTitle>Download failed</AlertTitle>
          <AlertDescription>{downloadError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadArchive}
            disabled={downloadingArchive}
            data-testid="student-keyed-archive-button"
          >
            {downloadingArchive ? "Downloading…" : "Download archive (.zip)"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadMapping}
            disabled={downloadingMapping}
            data-testid="student-keyed-mapping-button"
          >
            {downloadingMapping ? "Downloading…" : "Download mapping (.csv, private)"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onStartOver}>
            Start over
          </Button>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="destructive" data-testid="student-keyed-delete-button">
                Delete set
              </Button>
            </DialogTrigger>
            <DialogContent
              data-testid="student-keyed-delete-dialog"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete this student-keyed set?</DialogTitle>
                <DialogDescription>
                  This permanently removes all {data.students.length} member jobs, the key mapping,
                  and the set record. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  ref={cancelRef}
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                  data-testid="student-keyed-delete-confirm-button"
                >
                  {deleting ? "Deleting…" : "Delete permanently"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <SetMemberDialog
        member={openMember}
        setAccessToken={accessToken}
        sourceStem={sourceStem}
        onClose={() => setOpenMember(null)}
      />
    </div>
  );
}
