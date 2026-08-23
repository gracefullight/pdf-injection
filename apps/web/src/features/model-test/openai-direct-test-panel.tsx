import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEFAULT_OUTER_PROMPT } from "@/features/model-test/model-test-helpers";
import { fetchOutputPdfBytes } from "@/lib/api";
import { loadBrowserProviderSettings } from "@/lib/browser-provider-settings";
import { callOpenAiWithPdf } from "@/lib/openai-browser-client";

export interface OpenAiDirectTestPanelProps {
  jobId: string;
  accessToken: string;
}

export function OpenAiDirectTestPanel({ jobId, accessToken }: OpenAiDirectTestPanelProps) {
  const [status, setStatus] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setStatus("running");
    setAnswer("");
    setError(null);
    try {
      const provider = loadBrowserProviderSettings();
      const pdfBytes = await fetchOutputPdfBytes(jobId, accessToken);
      const response = await callOpenAiWithPdf({
        apiKey: provider.openAiApiKey,
        model: provider.openAiModel,
        pdfBytes,
        filename: `${jobId}.injected.pdf`,
        prompt: DEFAULT_OUTER_PROMPT,
      });
      setAnswer(response.outputText || "OpenAI returned no text output.");
      setStatus("complete");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "OpenAI request failed.");
      setStatus("error");
    }
  }

  return (
    <Card data-testid="openai-direct-test-panel">
      <CardHeader>
        <CardTitle>Direct OpenAI test (BYOK)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Sends the generated PDF directly from this browser to OpenAI using the key and model in
          Settings. The API key is not sent through the PDF Injection server.
        </p>
        <div>
          <Button type="button" onClick={handleRun} disabled={status === "running"}>
            {status === "running" ? "Running direct test…" : "Run direct OpenAI test"}
          </Button>
        </div>
        {error && (
          <Alert variant="destructive" data-testid="openai-direct-test-error">
            <AlertTitle>Direct test failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {status === "complete" && (
          <div className="rounded-md border border-border bg-muted p-4" aria-live="polite">
            <p className="mb-2 text-sm font-medium text-foreground">Model response</p>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">
              {answer}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
