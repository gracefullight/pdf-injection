import { LIMITS } from "@pdf-injection/contracts";
import { AlertTriangle, FileWarning, Lock, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfPageCanvas } from "@/features/pdf-preview/pdf-page-canvas";
import { usePdfDocument } from "@/features/pdf-preview/use-pdf-document";
import { FileDropZone } from "@/features/upload/file-drop-zone";
import type { UploadedSource } from "@/features/upload/upload-types";
import { hasPdfMagicBytes } from "@/lib/pdfjs";

export interface UploadScreenProps {
  source: UploadedSource | null;
  onSourceReady: (source: UploadedSource) => void;
  onContinue: () => void;
  /** True when a saved Instruction-screen draft (instruction/signals/settings) was restored from
   * sessionStorage on load but the PDF itself couldn't be (r11 review M-18 — the PDF bytes are
   * never persisted). Drives the "Draft restored" notice below. */
  draftRestored?: boolean;
  onClearDraft?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function UploadScreen({
  source,
  onSourceReady,
  onContinue,
  draftRestored,
  onClearDraft,
}: UploadScreenProps) {
  // Seeded from the `source` prop (parent-owned, survives this component's remount) rather than
  // starting empty every time — otherwise pressing "Back" from Instruction and returning to
  // Upload unmounts/remounts this component (App.tsx only renders it while `step === 1`), local
  // state resets, and the summary card + preview vanish even though the file is still loaded
  // (r11 review H-06).
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(() => source?.bytes ?? null);
  const [pendingFile, setPendingFile] = useState<File | null>(() => source?.file ?? null);
  const [clientError, setClientError] = useState<string | null>(null);
  const { document: pdfDocument, info, loading, error: parseError } = usePdfDocument(pendingBytes);

  async function handleFileSelected(file: File) {
    setClientError(null);

    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setClientError("Please choose a PDF file.");
      return;
    }
    if (file.size > LIMITS.maxFileBytes) {
      setClientError(`File exceeds the ${formatBytes(LIMITS.maxFileBytes)} size limit.`);
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasPdfMagicBytes(bytes)) {
      setClientError("This file does not look like a valid PDF (missing %PDF- header).");
      return;
    }

    setPendingFile(file);
    setPendingBytes(bytes);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: onSourceReady is a parent-owned callback; only re-run when the parsed source itself changes.
  useEffect(() => {
    if (!pendingFile || !pendingBytes || !info) return;

    if (info.pageCount > LIMITS.maxPages) {
      setClientError(`This document has ${info.pageCount} pages; the limit is ${LIMITS.maxPages}.`);
      return;
    }

    onSourceReady({
      file: pendingFile,
      bytes: pendingBytes,
      pageCount: info.pageCount,
      encrypted: info.encrypted,
      hasSignatureHint: info.hasSignatureHint,
      pdfJsVersion: info.pdfJsVersion,
    });
  }, [pendingFile, pendingBytes, info]);

  const activeSource = source;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">1. Upload source PDF</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload the assignment PDF you want to embed a hidden instruction into.
        </p>
      </div>

      <FileDropZone onFileSelected={handleFileSelected} disabled={loading} />
      {activeSource && !loading && (
        <p className="text-xs text-muted-foreground">
          Drop or choose a different PDF above to replace {activeSource.file.name}.
        </p>
      )}

      {draftRestored && (
        <Alert data-testid="draft-restored-notice">
          <AlertTitle>Draft restored</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Your in-progress instruction, signals, and settings were restored from this browser.
              Please re-select the PDF to continue. The file itself isn't saved between visits.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearDraft}
              data-testid="clear-draft-button"
            >
              Clear draft
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {clientError && (
        <Alert variant="destructive" data-testid="upload-client-error">
          <AlertTriangle />
          <AlertTitle>Cannot use this file</AlertTitle>
          <AlertDescription>{clientError}</AlertDescription>
        </Alert>
      )}

      {parseError && (
        <Alert variant="destructive" data-testid="upload-parse-error">
          <FileWarning />
          <AlertTitle>Could not parse PDF</AlertTitle>
          <AlertDescription>{parseError}</AlertDescription>
        </Alert>
      )}

      {loading && <p className="text-sm text-muted-foreground">Reading document…</p>}

      {activeSource && info && (
        <Card data-testid="upload-summary-card">
          <CardHeader>
            <CardTitle>{activeSource.file.name}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-40 shrink-0 overflow-hidden rounded border border-border">
              <PdfPageCanvas
                document={pdfDocument}
                pageNumber={1}
                scale={0.5}
                data-testid="upload-first-page-preview"
              />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatBytes(activeSource.file.size)}</dd>
              <dt className="text-muted-foreground">Pages</dt>
              <dd>{activeSource.pageCount}</dd>
              <dt className="text-muted-foreground">Encryption</dt>
              <dd>
                {activeSource.encrypted ? (
                  <Badge variant="destructive" className="gap-1">
                    <Lock className="size-3" /> Encrypted
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not encrypted</Badge>
                )}
              </dd>
              <dt className="text-muted-foreground">Signature</dt>
              <dd>
                {activeSource.hasSignatureHint ? (
                  <Badge variant="warning" className="gap-1">
                    <ShieldAlert className="size-3" /> Signature detected (best-effort)
                  </Badge>
                ) : (
                  <Badge variant="secondary">No signature detected</Badge>
                )}
              </dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {activeSource?.encrypted && (
        <Alert variant="warning">
          <AlertTitle>Encrypted PDFs are not supported</AlertTitle>
          <AlertDescription>
            The server will reject this file. Please upload an unencrypted PDF.
          </AlertDescription>
        </Alert>
      )}

      {activeSource?.hasSignatureHint && (
        <Alert variant="warning">
          <AlertTitle>Possible digital signature detected</AlertTitle>
          <AlertDescription>
            Modifying a digitally signed PDF invalidates its signature; the server will reject
            signed files.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
          data-testid="upload-continue-button"
          disabled={!activeSource || activeSource.encrypted || activeSource.hasSignatureHint}
          onClick={onContinue}
        >
          Continue to instruction
        </Button>
      </div>
    </div>
  );
}
