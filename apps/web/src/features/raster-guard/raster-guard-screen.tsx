import {
  ALL_VISION_PROVIDERS,
  assessPlan,
  deriveNoticeSignals,
  generateNoticeKey,
  getNoticeTemplate,
  lintNotice,
  type NoticeTemplateId,
  type NoticeVariables,
  renderCompactNotice,
  renderNotice,
  renderWatermark,
} from "@pdf-injection/raster-guard";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type BuildGuardedPdfResult,
  buildGuardedPdf,
} from "@/features/raster-guard/build-guarded-pdf";
import { CoverageReport } from "@/features/raster-guard/coverage-report";
import { signalLabel } from "@/features/raster-guard/evaluate-response";
import { type GuardSettings, GuardSettingsForm } from "@/features/raster-guard/guard-settings-form";
import { LiveCheckPanel } from "@/features/raster-guard/live-check-panel";
import { NoticeComposer } from "@/features/raster-guard/notice-composer";
import { ProviderViewPreview } from "@/features/raster-guard/provider-view-preview";
import { formatBytes } from "@/features/rasterizer/rasterizer-helpers";
import { FileDropZone } from "@/features/upload/file-drop-zone";
import { triggerBrowserDownload } from "@/lib/api";
import { getDocumentInfo, hasPdfMagicBytes, loadPdf } from "@/lib/pdfjs";

const DEFAULT_SETTINGS: GuardSettings = {
  tier: "subtle",
  providers: [...ALL_VISION_PROVIDERS],
  scope: "all",
  scale: 2,
};

function defaultVariables(): NoticeVariables {
  return {
    institution: "UTS",
    subject: "this subject",
    contact: "your subject coordinator",
    response: "",
    key: generateNoticeKey(),
  };
}

/**
 * Raster Guard — the pixel-space channel.
 *
 * Sits alongside the Injection Studio (which writes PDF *objects*) and the PDF
 * Rasterizer (which strips them). This screen does what neither does: it
 * rasterizes the document and then paints the notice into the resulting image,
 * so the payload is part of the page rather than an object attached to it.
 */
export function RasterGuardScreen() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState<NoticeTemplateId>("do_not_upload");
  const [variables, setVariables] = useState<NoticeVariables>(defaultVariables);
  const [settings, setSettings] = useState<GuardSettings>(DEFAULT_SETTINGS);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);
  const [result, setResult] = useState<BuildGuardedPdfResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const template = getNoticeTemplate(templateId);
  const noticeText = useMemo(() => renderNotice(template, variables), [template, variables]);
  const compactNoticeText = useMemo(
    () => renderCompactNotice(template, variables),
    [template, variables],
  );
  const watermarkText = useMemo(() => renderWatermark(template, variables), [template, variables]);
  const signals = useMemo(
    () =>
      deriveNoticeSignals({
        response: variables.response.trim() || template.defaultResponse,
        key: variables.key,
      }),
    [template, variables],
  );
  const lint = useMemo(
    () =>
      lintNotice(noticeText, signals, {
        responseSentence: variables.response.trim() || template.defaultResponse,
      }),
    [noticeText, signals, template, variables.response],
  );

  const coverage = useMemo(() => {
    if (!result) return [];
    return assessPlan({
      plan: result.plan,
      pages: result.pageSizes,
      rasterScale: result.scaleUsed,
      backgroundHex: result.backgroundHex,
      providers: settings.providers,
    });
  }, [result, settings.providers]);

  async function handleFileSelected(selected: File) {
    setError(null);
    setResult(null);
    setLoadingInfo(true);
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!hasPdfMagicBytes(bytes)) {
        setError("That file is not a PDF (no %PDF- header).");
        return;
      }
      const doc = await loadPdf(bytes);
      const info = await getDocumentInfo(doc);
      await doc.destroy();
      if (info.encrypted) {
        setError("Encrypted or password-protected PDFs cannot be processed.");
        return;
      }
      setFile(selected);
      setSourceBytes(bytes);
      setPageCount(info.pageCount);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open that PDF.");
    } finally {
      setLoadingInfo(false);
    }
  }

  function handleClearFile() {
    abortRef.current?.abort();
    setFile(null);
    setSourceBytes(null);
    setPageCount(null);
    setError(null);
    setResult(null);
    setProgress(null);
    setIsProcessing(false);
  }

  async function handleGenerate() {
    if (!sourceBytes) return;
    setError(null);
    setResult(null);
    setIsProcessing(true);
    setProgress({ current: 0, total: pageCount ?? 1, percent: 0 });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const built = await buildGuardedPdf(sourceBytes, {
        noticeText,
        compactNoticeText,
        watermarkText,
        tier: settings.tier,
        targetProviders: settings.providers,
        scope: settings.scope,
        expectedSignals: signals,
        scale: settings.scale,
        signal: controller.signal,
        onProgress: setProgress,
      });
      setResult(built);
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "Generation was cancelled."
          : cause instanceof Error
            ? cause.message
            : "Could not generate the guarded PDF.",
      );
    } finally {
      setIsProcessing(false);
      abortRef.current = null;
    }
  }

  function handleDownload() {
    if (!result || !file) return;
    triggerBrowserDownload({
      blob: new Blob([result.bytes as BlobPart], { type: "application/pdf" }),
      filename: `${file.name.replace(/\.pdf$/i, "")}-guarded.pdf`,
    });
  }

  const canGenerate =
    sourceBytes !== null && lint.errors.length === 0 && settings.providers.length > 0;

  return (
    <div className="flex flex-col gap-6" data-testid="raster-guard-screen">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-foreground">Raster Guard</h2>
          <Badge variant="outline" className="text-xs">
            Client-Side · On-Device
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Rasterizes the document, then paints an academic integrity notice into the page image
          itself. An assistant that reads the page sees the notice and is asked to send the student
          back to their instructor. Because the notice is pixels rather than a PDF text object,
          nothing can strip it without destroying the page.
        </p>
      </div>

      <Alert>
        <Sparkles aria-hidden="true" />
        <AlertTitle>What this is, and is not</AlertTitle>
        <AlertDescription>
          The notice is visible to anyone who looks at the page — that is deliberate, and it is what
          keeps this auditable. It is not a covert channel, not a guarantee that any assistant will
          comply, and not evidence about a student on its own. Every coverage figure below is a
          prediction from published ingestion behaviour until you run a live check.
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive" data-testid="raster-guard-error">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!file ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Select the assignment PDF</CardTitle>
            <CardDescription>
              Nothing leaves this browser until you run a live check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FileDropZone
              onFileSelected={handleFileSelected}
              disabled={loadingInfo}
              label={
                loadingInfo ? "Inspecting PDF…" : "Drag and drop a PDF here, or click to browse"
              }
              helperText="Standard PDF, up to 100 pages"
              data-testid-container="raster-guard-dropzone"
              data-testid-input="raster-guard-file-input"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between pb-3">
            <div>
              <CardTitle className="text-base">1. Source document</CardTitle>
              <CardDescription>Ready to guard</CardDescription>
            </div>
            {!isProcessing && (
              <Button variant="ghost" size="sm" onClick={handleClearFile}>
                <X className="mr-1 size-4" aria-hidden="true" />
                Change file
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4 rounded-md border bg-muted/40 p-3 text-sm">
              <FileText className="size-8 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(file.size)} · {pageCount ?? 0} {pageCount === 1 ? "page" : "pages"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {file && (
        <>
          <NoticeComposer
            templateId={templateId}
            onTemplateIdChange={setTemplateId}
            variables={variables}
            onVariablesChange={setVariables}
            noticeText={noticeText}
            lint={lint}
          />

          <GuardSettingsForm settings={settings} onChange={setSettings} disabled={isProcessing} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Generate</CardTitle>
              <CardDescription>
                Every page is rendered to a bitmap, the notice is painted into it, and the result is
                rebuilt as an image-only PDF.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {settings.providers.length === 0 && (
                <Alert variant="warning">
                  <AlertTitle>Select at least one assistant</AlertTitle>
                  <AlertDescription>
                    The notice is sized from the pipelines you target. With none selected there is
                    nothing to size against.
                  </AlertDescription>
                </Alert>
              )}

              {isProcessing && progress && (
                <div className="flex flex-col gap-2 rounded-lg border bg-accent/20 p-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Guarding page {progress.current} of {progress.total}…
                    </span>
                    <span>{progress.percent}%</span>
                  </div>
                  <Progress value={progress.percent} />
                </div>
              )}

              <div className="flex items-center gap-3">
                {!isProcessing ? (
                  <Button
                    type="button"
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    data-testid="generate-guarded-pdf"
                  >
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    Generate guarded PDF
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-4" aria-hidden="true" />
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {result && sourceBytes && file && (
        <Card className="border-primary/40">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-5 text-green-600" aria-hidden="true" />
              <CardTitle className="text-base">Guarded PDF ready</CardTitle>
              {result.isTextFree ? (
                <Badge variant="success">No extractable text</Badge>
              ) : (
                <Badge variant="warning">
                  {result.totalExtractedCharacters} characters still extractable
                </Badge>
              )}
            </div>
            <CardDescription>
              {result.plan.instances.length} notice copies painted across {result.pageCount}{" "}
              {result.pageCount === 1 ? "page" : "pages"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Original size" value={formatBytes(result.originalSizeBytes)} />
              <Metric label="Guarded size" value={formatBytes(result.guardedSizeBytes)} />
              <Metric label="Pages" value={String(result.pageCount)} />
              <Metric
                label="Raster resolution"
                value={`${Math.round(result.scaleUsed * 72)} DPI`}
              />
            </div>

            {result.plan.warnings.length > 0 && (
              <Alert variant="warning" data-testid="raster-guard-plan-warnings">
                <AlertTitle>Placement notes</AlertTitle>
                <AlertDescription>
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {result.plan.warnings.map((warning) => (
                      <li key={`${warning.code}-${warning.pageIndex}-${warning.channel}`}>
                        {warning.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={handleDownload} data-testid="download-guarded-pdf">
                <Download className="size-4" aria-hidden="true" />
                Download guarded PDF
              </Button>
              <Button type="button" variant="outline" onClick={handleClearFile}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Guard another PDF
              </Button>
            </div>

            <Tabs defaultValue="coverage">
              <TabsList>
                <TabsTrigger value="coverage" data-testid="tab-coverage">
                  Coverage
                </TabsTrigger>
                <TabsTrigger value="preview" data-testid="tab-preview">
                  What the model sees
                </TabsTrigger>
                <TabsTrigger value="live" data-testid="tab-live">
                  Live check
                </TabsTrigger>
                <TabsTrigger value="canaries" data-testid="tab-canaries">
                  Canaries
                </TabsTrigger>
              </TabsList>

              <TabsContent value="coverage" className="pt-4">
                <CoverageReport
                  coverage={coverage}
                  plan={result.plan}
                  backgroundHex={result.backgroundHex}
                />
              </TabsContent>

              <TabsContent value="preview" className="pt-4">
                <ProviderViewPreview
                  pdfBytes={result.bytes}
                  providers={settings.providers}
                  rasterScale={result.scaleUsed}
                />
              </TabsContent>

              <TabsContent value="live" className="pt-4">
                <LiveCheckPanel
                  pdfBytes={result.bytes}
                  filename={`${file.name.replace(/\.pdf$/i, "")}-guarded.pdf`}
                  providers={settings.providers}
                  signals={result.plan.expectedSignals}
                />
              </TabsContent>

              <TabsContent value="canaries" className="flex flex-col gap-3 pt-4">
                <p className="text-sm text-muted-foreground">
                  Keep these with the notice reference code. They are what a suspected AI-assisted
                  submission is scored against later — match evidence, never a verdict.
                </p>
                <ul className="flex flex-col gap-2">
                  {result.plan.expectedSignals.map((signal) => (
                    <li
                      key={signalLabel(signal)}
                      className="rounded-md border p-3 text-sm text-foreground"
                    >
                      {signalLabel(signal)}
                    </li>
                  ))}
                </ul>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}
