import type { ScreenshotOcrResult } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDropZone } from "@/features/upload/file-drop-zone";
import { FeatureGate, type Features } from "@/lib/features";

export interface ScreenshotOcrPanelProps {
  features: Features;
  onUpload: (files: File[]) => Promise<ScreenshotOcrResult>;
}

export function ScreenshotOcrPanel({ features, onUpload }: ScreenshotOcrPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ScreenshotOcrResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFilesSelected(files: File[]) {
    setUploading(true);
    setError(null);
    try {
      const ocrResult = await onUpload(files);
      setResult(ocrResult);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Screenshot OCR failed.");
      setResult(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="screenshot-ocr-panel">
      <h4 className="text-sm font-semibold text-foreground">Screenshot OCR</h4>
      <FeatureGate feature="ocrAvailable" features={features}>
        <div className="flex flex-col gap-2">
          <FileDropZone
            multiple
            accept="image/png,image/jpeg"
            onFilesSelected={handleFilesSelected}
            disabled={uploading}
            label="Drag and drop a screenshot here, or click to browse"
            helperText="Upload a screenshot of the assignment to check whether OCR recovers the hidden text (processed locally). PNG or JPEG."
            data-testid-container="screenshot-ocr-drop-zone"
            data-testid-input="screenshot-ocr-file-input"
          />
          {uploading && <span className="text-sm text-muted-foreground">Extracting…</span>}
        </div>

        {error && (
          <Alert variant="destructive" data-testid="screenshot-ocr-error">
            <AlertTitle>OCR failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Card data-testid="screenshot-ocr-result">
            <CardHeader>
              <CardTitle className="text-base">Extraction result</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">OCR confidence: </span>
                {result.ocrConfidence === null
                  ? "—"
                  : `${(result.ocrConfidence * 100).toFixed(1)}%`}
              </div>
              <div>
                <span className="text-muted-foreground">Hidden text extracted: </span>
                {result.extraction.hiddenTextExtracted ? "Yes" : "No"}
              </div>
              <div>
                <span className="text-muted-foreground">Target page match: </span>
                {result.extraction.targetPageMatch ? "Yes" : "No"}
              </div>
              <details>
                <summary className="cursor-pointer text-muted-foreground">
                  Extracted text (collapsed by default)
                </summary>
                <pre
                  className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-secondary p-2"
                  data-testid="screenshot-ocr-text"
                >
                  {result.text}
                </pre>
              </details>
            </CardContent>
          </Card>
        )}
      </FeatureGate>
    </div>
  );
}
