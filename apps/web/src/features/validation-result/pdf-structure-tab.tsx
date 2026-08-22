import type { ValidationReport } from "@pdf-injection/contracts";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PdfStructureTabProps {
  report: ValidationReport | null;
}

function formatBox(box: readonly [number, number, number, number]): string {
  return box.map((n) => n.toFixed(1)).join(", ");
}

const QPDF_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  passed: "success",
  warning: "warning",
  failed: "destructive",
  not_run: "secondary",
};

const QPDF_LABEL: Record<string, string> = {
  passed: "Passed",
  warning: "Warning",
  failed: "Failed",
  not_run: "Not run (optional)",
};

export function PdfStructureTab({ report }: PdfStructureTabProps) {
  if (!report) {
    return <p className="text-sm text-muted-foreground">Validation report not available yet.</p>;
  }

  const qpdfStatus = report.summary.qpdfStatus;

  return (
    <div className="flex flex-col gap-4" data-testid="pdf-structure-tab">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <dt className="text-muted-foreground">Page count (source)</dt>
        <dd>{report.source.pageCount}</dd>
        <dt className="text-muted-foreground">Page count (output)</dt>
        <dd>{report.output.pageCount}</dd>
        <dt className="text-muted-foreground">File size delta</dt>
        <dd>
          {report.output.fileSizeDelta >= 0 ? "+" : ""}
          {report.output.fileSizeDelta} bytes
        </dd>
        <dt className="text-muted-foreground">qpdf status</dt>
        <dd>
          <Badge variant={QPDF_VARIANT[qpdfStatus] ?? "secondary"}>
            {QPDF_LABEL[qpdfStatus] ?? qpdfStatus}
          </Badge>
        </dd>
        <dt className="text-muted-foreground">Geometry preserved</dt>
        <dd>
          <Badge variant={report.summary.pageGeometryPreserved ? "success" : "destructive"}>
            {report.summary.pageGeometryPreserved ? "Yes" : "No"}
          </Badge>
        </dd>
      </dl>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            <TableHead>MediaBox</TableHead>
            <TableHead>CropBox</TableHead>
            <TableHead>Rotation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.output.pages.map((page) => (
            <TableRow key={page.pageIndex}>
              <TableCell>{page.pageIndex + 1}</TableCell>
              <TableCell>{formatBox(page.mediaBox)}</TableCell>
              <TableCell>{formatBox(page.cropBox)}</TableCell>
              <TableCell>{page.rotation}°</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
