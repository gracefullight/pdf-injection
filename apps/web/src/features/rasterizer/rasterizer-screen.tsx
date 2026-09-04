import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Layers,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type RasterizeResult, rasterizePdfInBrowser } from "@/features/rasterizer/rasterize-pdf";
import {
  calculateSizeDelta,
  FORMAT_OPTIONS,
  formatBytes,
  RESOLUTION_OPTIONS,
} from "@/features/rasterizer/rasterizer-helpers";
import { FileDropZone } from "@/features/upload/file-drop-zone";
import { triggerBrowserDownload } from "@/lib/api";
import { getDocumentInfo, hasPdfMagicBytes, loadPdf } from "@/lib/pdfjs";

export function RasterizerScreen() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scale, setScale] = useState<number>(2.0);
  const [imageFormat, setImageFormat] = useState<"image/png" | "image/jpeg">("image/png");

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const [result, setResult] = useState<RasterizeResult | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  async function handleFileSelected(selectedFile: File) {
    setError(null);
    setResult(null);
    setLoadingInfo(true);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (!hasPdfMagicBytes(bytes)) {
        setError("The selected file is not a valid PDF document (missing %PDF- header).");
        setLoadingInfo(false);
        return;
      }

      const doc = await loadPdf(bytes);
      const info = await getDocumentInfo(doc);
      await doc.destroy();

      if (info.encrypted) {
        setError("Encrypted or password-protected PDFs cannot be rasterized.");
        setLoadingInfo(false);
        return;
      }

      setFile(selectedFile);
      setSourceBytes(bytes);
      setPageCount(info.pageCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the selected PDF.");
    } finally {
      setLoadingInfo(false);
    }
  }

  function handleClearFile() {
    if (isProcessing) {
      abortControllerRef.current?.abort();
    }
    setFile(null);
    setSourceBytes(null);
    setPageCount(null);
    setError(null);
    setResult(null);
    setProgress(null);
    setIsProcessing(false);
  }

  async function handleStartRasterize() {
    if (!sourceBytes) return;

    setError(null);
    setIsProcessing(true);
    setProgress({ current: 0, total: pageCount ?? 1, percent: 0 });

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const rasterizeOutput = await rasterizePdfInBrowser(sourceBytes, {
        scale,
        imageFormat,
        jpegQuality: 0.85,
        signal: abortController.signal,
        onProgress: (p) => setProgress(p),
      });
      setResult(rasterizeOutput);
    } catch (err) {
      if (abortController.signal.aborted) {
        setError("Rasterization was cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to rasterize the PDF.");
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  function handleDownload() {
    if (!result || !file) return;
    const baseName = file.name.replace(/\.pdf$/i, "");
    const downloadFilename = `${baseName}-rasterized.pdf`;
    triggerBrowserDownload({
      blob: new Blob([result.bytes as BlobPart], { type: "application/pdf" }),
      filename: downloadFilename,
    });
  }

  const sizeDelta = result
    ? calculateSizeDelta(result.originalSizeBytes, result.rasterizedSizeBytes)
    : null;

  return (
    <div className="flex flex-col gap-6" data-testid="rasterizer-screen">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-foreground">PDF Rasterizer & Sanitizer</h2>
          <Badge variant="outline" className="text-xs">
            Client-Side · On-Device
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Convert all pages into high-resolution bitmap images. Strips invisible fonts, hidden
          prompt injections, and extractable text layers completely while preserving 100% visual
          layout.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* File Upload / Info Box */}
      {!file ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Select Source PDF</CardTitle>
            <CardDescription>
              Choose a PDF document to sanitize and rasterize. Nothing leaves your browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDropZone
              onFileSelected={handleFileSelected}
              disabled={loadingInfo}
              label={
                loadingInfo
                  ? "Inspecting PDF document…"
                  : "Drag and drop a PDF here, or click to browse"
              }
              helperText="Standard PDF, up to 100 pages"
              data-testid-container="rasterizer-dropzone"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-3">
            <div>
              <CardTitle className="text-base">Source Document</CardTitle>
              <CardDescription>Document ready for rasterization</CardDescription>
            </div>
            {!isProcessing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFile}
                className="text-muted-foreground hover:text-foreground"
                data-testid="clear-file-button"
              >
                <X className="mr-1 size-4" />
                Change File
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/40 p-3 text-sm">
              <FileText className="size-8 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} · {pageCount ?? 0} {pageCount === 1 ? "page" : "pages"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings (visible when file is loaded and not yet completed) */}
      {file && !result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Rasterization Settings</CardTitle>
            <CardDescription>
              Configure image resolution and compression for the rebuilt PDF pages.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="rasterize-scale" className="text-sm font-medium text-foreground">
                  Resolution (DPI)
                </label>
                <Select
                  value={String(scale)}
                  onValueChange={(val) => setScale(Number(val))}
                  disabled={isProcessing}
                >
                  <SelectTrigger id="rasterize-scale">
                    <SelectValue placeholder="Select resolution" />
                  </SelectTrigger>
                  <SelectContent>
                    {RESOLUTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.scale} value={String(opt.scale)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {RESOLUTION_OPTIONS.find((o) => o.scale === scale)?.description}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="rasterize-format" className="text-sm font-medium text-foreground">
                  Page Image Compression
                </label>
                <Select
                  value={imageFormat}
                  onValueChange={(val) => setImageFormat(val as "image/png" | "image/jpeg")}
                  disabled={isProcessing}
                >
                  <SelectTrigger id="rasterize-format">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMAT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.format} value={opt.format}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {FORMAT_OPTIONS.find((o) => o.format === imageFormat)?.description}
                </p>
              </div>
            </div>

            {/* In-Flight Progress */}
            {isProcessing && progress && (
              <div className="flex flex-col gap-2 rounded-lg border bg-accent/20 p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Rasterizing page {progress.current} of {progress.total}…
                  </span>
                  <span>{progress.percent}%</span>
                </div>
                <Progress value={progress.percent} />
                <p className="text-xs text-muted-foreground">
                  Rendering PDF page to canvas and re-embedding into clean PDF document…
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              {!isProcessing ? (
                <Button
                  type="button"
                  onClick={handleStartRasterize}
                  className="gap-2"
                  data-testid="start-rasterize-button"
                >
                  <Layers className="size-4" />
                  Rasterize PDF
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCancel}
                  className="gap-2 text-destructive hover:bg-destructive/10"
                >
                  <X className="size-4" />
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed Result Card */}
      {result && (
        <Card className="border-primary/40">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-green-600" />
              <CardTitle className="text-base text-foreground">Rasterization Complete</CardTitle>
              <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                100% Text-Free
              </Badge>
            </div>
            <CardDescription>
              All pages have been successfully rendered to bitmap images and rebuilt into an
              image-only PDF.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* Guarantee callout */}
            <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50/50 p-4 text-sm dark:border-green-900/50 dark:bg-green-950/20">
              <ShieldCheck className="size-5 text-green-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
                <span className="font-medium text-green-900 dark:text-green-300">
                  Defensive Sanitization Verified
                </span>
                <span className="text-xs text-green-800 dark:text-green-400">
                  {result.isTextFree
                    ? "Verified: 0 text characters found. Hidden instructions, prompt injections, and invisible font payloads cannot be extracted by any text-based model or parser."
                    : `Notice: ${result.totalExtractedCharacters} text characters detected.`}
                </span>
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Original Size</p>
                <p className="mt-1 text-sm font-semibold">
                  {formatBytes(result.originalSizeBytes)}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Rasterized Size</p>
                <p className="mt-1 text-sm font-semibold">
                  {formatBytes(result.rasterizedSizeBytes)}{" "}
                  {sizeDelta && (
                    <span
                      className={`text-xs font-normal ${
                        sizeDelta.isIncrease ? "text-amber-600" : "text-green-600"
                      }`}
                    >
                      ({sizeDelta.label})
                    </span>
                  )}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Pages</p>
                <p className="mt-1 text-sm font-semibold">{result.pageCount} pages</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Resolution</p>
                <p className="mt-1 text-sm font-semibold">
                  {Math.round(result.scaleUsed * 72)} DPI (
                  {result.formatUsed === "image/png" ? "PNG" : "JPEG"})
                </p>
              </div>
            </div>

            {/* Download & Reset actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                onClick={handleDownload}
                className="gap-2"
                data-testid="download-rasterized-button"
              >
                <Download className="size-4" />
                Download Rasterized PDF
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearFile}
                className="gap-2"
                data-testid="rasterize-another-button"
              >
                <RotateCcw className="size-4" />
                Sanitize Another PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
