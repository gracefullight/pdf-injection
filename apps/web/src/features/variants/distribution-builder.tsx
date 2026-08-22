import type { DistributionResponse, DistributionStrategy } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { deriveDistributionRows, distributionToCsv } from "@/features/variants/distribution-table";
import { parseStudentIdList } from "@/features/variants/student-id-list";
import { triggerBrowserDownload } from "@/lib/api";
import { postDistribution } from "@/lib/api-variant-sets";
import { ResearchApiError } from "@/lib/research-fetch";

export interface DistributionBuilderProps {
  variantSetId: string;
  accessToken: string;
  sourceStem: string;
}

/** Student ids + strategy + seed -> assignments table + per-label counts + CSV download. */
export function DistributionBuilder({
  variantSetId,
  accessToken,
  sourceStem,
}: DistributionBuilderProps) {
  const [studentIdsRaw, setStudentIdsRaw] = useState("");
  const [strategy, setStrategy] = useState<DistributionStrategy>("round_robin");
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<DistributionResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { ids } = parseStudentIdList(studentIdsRaw);
  const canBuild = ids.length > 0 && status !== "loading";

  async function handleBuild() {
    if (!canBuild) return;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const response = await postDistribution({
        setId: variantSetId,
        accessToken,
        body: { studentIds: ids, strategy, seed: seed.trim() || undefined },
      });
      setResult(response);
      setStatus("idle");
    } catch (error) {
      setErrorMessage(
        error instanceof ResearchApiError ? error.message : "Could not build the distribution.",
      );
      setStatus("error");
    }
  }

  function handleDownloadCsv() {
    if (!result) return;
    // Generated client-side from the assignments the server already returned
    // (rather than a second round trip to the `?format=csv` endpoint) — see
    // distribution-table.ts.
    const rows = deriveDistributionRows(result);
    const csv = distributionToCsv(rows);
    triggerBrowserDownload({
      blob: new Blob([csv], { type: "text/csv" }),
      filename: `${sourceStem}.distribution.csv`,
    });
  }

  const rows = result ? deriveDistributionRows(result) : [];

  return (
    <div className="flex flex-col gap-4" data-testid="distribution-builder">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="distribution-student-ids">Student ids (one per line)</Label>
        <Textarea
          id="distribution-student-ids"
          rows={6}
          value={studentIdsRaw}
          onChange={(event) => setStudentIdsRaw(event.target.value)}
          placeholder={"s001\ns002\ns003"}
          data-testid="distribution-student-ids-textarea"
        />
        <p className="text-xs text-muted-foreground">{ids.length} unique student ids</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="distribution-strategy">Strategy</Label>
          <Select
            value={strategy}
            onValueChange={(value) => setStrategy(value as DistributionStrategy)}
          >
            <SelectTrigger id="distribution-strategy" data-testid="distribution-strategy-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round_robin">Round robin</SelectItem>
              <SelectItem value="seeded_hash">Seeded hash (deterministic)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="distribution-seed">Seed (optional)</Label>
          <Input
            id="distribution-seed"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            disabled={strategy !== "seeded_hash"}
            data-testid="distribution-seed-input"
          />
        </div>
      </div>

      {errorMessage && (
        <Alert variant="destructive" data-testid="distribution-error">
          <AlertTitle>Could not build the distribution</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button
          type="button"
          onClick={handleBuild}
          disabled={!canBuild}
          data-testid="distribution-build-button"
        >
          {status === "loading" ? "Building…" : "Build distribution"}
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-3" data-testid="distribution-result">
          <div className="flex flex-wrap items-center gap-2">
            {Object.entries(result.counts).map(([label, count]) => (
              <Badge
                key={label}
                variant={count === 0 ? "warning" : "secondary"}
                data-testid={`distribution-count-${label}`}
              >
                {label}: {count}
              </Badge>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadCsv}
              data-testid="distribution-csv-download"
            >
              Download CSV
            </Button>
          </div>
          {Object.values(result.counts).some((count) => count === 0) && (
            <Alert variant="warning" data-testid="distribution-zero-count-warning">
              <AlertTitle>A variant received no students</AlertTitle>
              <AlertDescription>
                One or more variant labels were not assigned to any student with this seed/strategy.
                Try a different seed or use round-robin instead.
              </AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student id</TableHead>
                <TableHead>Label</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.studentId} data-testid={`distribution-row-${row.studentId}`}>
                  <TableCell>{row.studentId}</TableCell>
                  <TableCell>{row.label}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
