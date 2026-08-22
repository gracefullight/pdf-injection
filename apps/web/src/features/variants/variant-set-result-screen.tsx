import type { VariantSetResponse } from "@pdf-injection/contracts";
import { useQuery } from "@tanstack/react-query";
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
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OverallBadge } from "@/features/validation-result/overall-badge";
import { DistributionBuilder } from "@/features/variants/distribution-builder";
import { type SetMember, SetMemberDialog } from "@/features/variants/set-member-dialog";
import { triggerBrowserDownload } from "@/lib/api";
import { deleteVariantSet, downloadVariantSetArchive, getVariantSet } from "@/lib/api-variant-sets";
import { ResearchApiError } from "@/lib/research-fetch";

export interface VariantSetResultScreenProps {
  variantSetId: string;
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

function hasPendingMember(data: VariantSetResponse | undefined): boolean {
  return (data?.variants ?? []).some(
    (variant) => variant.status === "queued" || variant.status === "processing",
  );
}

/** Step 4 result screen for `distributionMode: "variants"` — per-variant table, distribution builder, archive, delete. */
export function VariantSetResultScreen({
  variantSetId,
  accessToken,
  sourceStem,
  onDeleted,
  onStartOver,
}: VariantSetResultScreenProps) {
  const [openMember, setOpenMember] = useState<SetMember | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingArchive, setDownloadingArchive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const setQuery = useQuery({
    queryKey: ["variant-set", variantSetId],
    queryFn: () => getVariantSet(variantSetId, accessToken),
    refetchInterval: (query) => (hasPendingMember(query.state.data) ? 1000 : false),
  });

  async function handleDownloadArchive() {
    setDownloadingArchive(true);
    setDownloadError(null);
    try {
      triggerBrowserDownload(
        await downloadVariantSetArchive(variantSetId, accessToken, sourceStem),
      );
    } catch (error) {
      setDownloadError(
        error instanceof ResearchApiError ? error.message : "Could not download the archive.",
      );
    } finally {
      setDownloadingArchive(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteVariantSet(variantSetId, accessToken);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  if (setQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading variant set…</p>;
  }

  if (setQuery.isError || !setQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load variant set</AlertTitle>
        <AlertDescription>
          {setQuery.error instanceof ResearchApiError
            ? setQuery.error.message
            : "Unexpected error."}
        </AlertDescription>
      </Alert>
    );
  }

  const data = setQuery.data;

  return (
    <div className="flex flex-col gap-6" data-testid="variant-set-result-screen">
      <div>
        <h2 className="text-xl font-semibold text-foreground">4. Validate: variant set</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.variants.length} variants generated from the same source.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Client validation</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.variants.map((variant) => (
            <TableRow key={variant.label} data-testid={`variant-set-row-${variant.label}`}>
              <TableCell className="font-medium">{variant.label}</TableCell>
              <TableCell>
                <Badge variant={JOB_STATUS_VARIANT[variant.status] ?? "secondary"}>
                  {variant.status}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-0.5">
                  <OverallBadge status={variant.summary?.overall ?? null} />
                  {/* API returns the literal string "NOT_TESTED" (not null/undefined) when client
                   * validation hasn't run yet — `!variant.summary?.overall` was always false for
                   * that truthy non-empty string, so this caption never rendered (M-10 cycle 3
                   * residual: designer re-verification found the caption missing live). */}
                  {(variant.summary?.overall == null ||
                    variant.summary.overall === "NOT_TESTED") && (
                    <span className="text-xs text-muted-foreground">Not run: open to validate</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOpenMember({
                      jobId: variant.jobId,
                      accessToken: variant.accessToken,
                      label: variant.label,
                    })
                  }
                  disabled={variant.status !== "completed"}
                  data-testid={`variant-set-open-${variant.label}`}
                >
                  Open
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Separator />

      <div>
        <h3 className="text-lg font-semibold text-foreground">Distribution</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Assign each student a variant label, either round-robin or a deterministic seeded hash.
        </p>
        <div className="mt-3">
          <DistributionBuilder
            variantSetId={variantSetId}
            accessToken={accessToken}
            sourceStem={sourceStem}
          />
        </div>
      </div>

      <Separator />

      {downloadError && (
        <Alert variant="destructive">
          <AlertTitle>Could not download the archive</AlertTitle>
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
            data-testid="variant-set-archive-button"
          >
            {downloadingArchive ? "Downloading…" : "Download archive (.zip)"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onStartOver}>
            Start over
          </Button>
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="destructive" data-testid="variant-set-delete-button">
                Delete set
              </Button>
            </DialogTrigger>
            <DialogContent
              data-testid="variant-set-delete-dialog"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                cancelRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>Delete this variant set?</DialogTitle>
                <DialogDescription>
                  This permanently removes all {data.variants.length} member jobs and the set
                  record. This action cannot be undone.
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
                  data-testid="variant-set-delete-confirm-button"
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
