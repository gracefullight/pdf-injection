import { LIMITS } from "@pdf-injection/contracts";
import { AlertTriangle, FileWarning, Lock, Maximize2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PdfFullPreviewDialog } from "@/features/pdf-preview/pdf-full-preview-dialog";
import { PdfPageCanvas } from "@/features/pdf-preview/pdf-page-canvas";
import { usePdfDocument } from "@/features/pdf-preview/use-pdf-document";
import { FileDropZone } from "@/features/upload/file-drop-zone";
import {
  buildSampleFile,
  decideSampleCheckboxAction,
  SAMPLE_PDF_CHECKBOX_LABEL,
  SAMPLE_PDF_URL,
  type SourceOrigin,
} from "@/features/upload/sample-source";
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
  /** Clears the parent-owned `source` back to `null`. Wired up so unchecking the sample checkbox
   * (Feature 1) can put the screen back to just the drop zone — `activeSource` below is the
   * `source` prop itself, not this component's local pending state, so a local-only clear isn't
   * enough to make the summary card/preview/Continue button disappear again. */
  onClearSource?: () => void;
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
  onClearSource,
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

  // Tracks which of the two alternative ways (manual drop/pick vs. the sample checkbox) set the
  // currently-loaded source, so the two stay mutually exclusive. Not derived from `source.file`
  // (e.g. by name) since a manually-picked file could coincidentally share the sample's filename.
  // Deliberately *not* seeded from `source` on mount (always starts `null`/unchecked) — matches
  // the "default unchecked" requirement even on the Back-navigation remount case above, where we
  // have no reliable signal of how the still-loaded source was originally set.
  const [sourceOrigin, setSourceOrigin] = useState<SourceOrigin>(null);
  const [useSample, setUseSample] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Guards against a stale fetch applying its result after a later toggle superseded it (e.g. the
  // user unchecks the sample while its fetch is still in flight).
  const sampleRequestIdRef = useRef(0);

  async function handleFileSelected(file: File, origin: SourceOrigin = "manual") {
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
    setSourceOrigin(origin);
    // A manual drop/pick always wins over — and cleanly replaces — a checked sample (r11 spec:
    // "if the user manually drops a file, uncheck/replace the sample cleanly").
    if (origin === "manual") setUseSample(false);
  }

  async function handleSampleToggle(checked: boolean) {
    const action = decideSampleCheckboxAction(checked, sourceOrigin);

    if (action.type === "ignore") {
      setUseSample(false);
      return;
    }

    if (action.type === "clear") {
      sampleRequestIdRef.current += 1; // cancel any in-flight fetch too
      setUseSample(false);
      setSourceOrigin(null);
      setPendingFile(null);
      setPendingBytes(null);
      setClientError(null);
      onClearSource?.();
      return;
    }

    // action.type === "fetch"
    setUseSample(true);
    setClientError(null);
    setSampleLoading(true);
    const requestId = ++sampleRequestIdRef.current;

    try {
      const response = await fetch(SAMPLE_PDF_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (requestId !== sampleRequestIdRef.current) return; // superseded by a later toggle
      await handleFileSelected(buildSampleFile(bytes), "sample");
    } catch {
      if (requestId !== sampleRequestIdRef.current) return;
      setClientError("Could not load the sample PDF. Please try again or upload your own file.");
      setUseSample(false);
    } finally {
      if (requestId === sampleRequestIdRef.current) setSampleLoading(false);
    }
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

      <FileDropZone onFileSelected={handleFileSelected} disabled={loading || sampleLoading} />
      {activeSource && !loading && (
        <p className="text-xs text-muted-foreground">
          Drop or choose a different PDF above to replace {activeSource.file.name}.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="upload-use-sample-checkbox"
          checked={useSample}
          disabled={sampleLoading || loading}
          onCheckedChange={(checked) => handleSampleToggle(checked === true)}
          data-testid="upload-use-sample-checkbox"
        />
        <Label htmlFor="upload-use-sample-checkbox" className="font-normal">
          {SAMPLE_PDF_CHECKBOX_LABEL}
        </Label>
        {sampleLoading && (
          <span className="text-xs text-muted-foreground" data-testid="upload-sample-loading">
            Loading sample…
          </span>
        )}
      </div>

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
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="group relative w-40 shrink-0 cursor-pointer overflow-hidden rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="upload-first-page-preview-trigger"
              aria-label={`View full PDF (${activeSource.pageCount} pages)`}
            >
              <PdfPageCanvas
                document={pdfDocument}
                pageNumber={1}
                scale={0.5}
                data-testid="upload-first-page-preview"
              />
              {/* Discoverability affordance — the thumbnail alone doesn't read as clickable. */}
              <span className="absolute inset-0 flex items-center justify-center gap-1 bg-foreground/0 text-transparent transition-colors group-hover:bg-foreground/40 group-hover:text-background group-focus-visible:bg-foreground/40 group-focus-visible:text-background motion-reduce:transition-none">
                <Maximize2 className="size-4" aria-hidden="true" />
                <span className="text-xs font-medium">View full PDF</span>
              </span>
            </button>
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

      {activeSource && (
        <PdfFullPreviewDialog
          document={pdfDocument}
          pageCount={activeSource.pageCount}
          fileName={activeSource.file.name}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
        />
      )}
    </div>
  );
}
