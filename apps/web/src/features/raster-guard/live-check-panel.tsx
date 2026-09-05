import type { ExpectedSignal } from "@pdf-injection/contracts";
import { getProviderProfile, type VisionProviderId } from "@pdf-injection/raster-guard";
import { Play } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  checkNoticeResponse,
  type NoticeCheckResult,
} from "@/features/raster-guard/evaluate-response";
import {
  callClaudeWithPdf,
  callGeminiWithPdf,
  STUDENT_STYLE_PROMPT,
  type VisionCheckResponse,
} from "@/features/raster-guard/vision-clients";
import { loadBrowserProviderSettings } from "@/lib/browser-provider-settings";
import { callOpenAiWithPdf } from "@/lib/openai-browser-client";

type RunState = "idle" | "running" | "done" | "error";

interface ProviderRun {
  state: RunState;
  answer: string;
  error: string | null;
  check: NoticeCheckResult | null;
}

const EMPTY_RUN: ProviderRun = { state: "idle", answer: "", error: null, check: null };

/**
 * Uploads the guarded PDF to a real assistant with a student-shaped prompt and
 * scores what comes back against the notice's canaries.
 *
 * One run against one assistant is an observation, not a rate. The result copy
 * says that every time rather than only in documentation, because a single
 * green result is exactly the thing most likely to be quoted as proof.
 */
export function LiveCheckPanel({
  pdfBytes,
  filename,
  providers,
  signals,
}: {
  pdfBytes: Uint8Array;
  filename: string;
  providers: VisionProviderId[];
  signals: ExpectedSignal[];
}) {
  const [prompt, setPrompt] = useState(STUDENT_STYLE_PROMPT);
  const [runs, setRuns] = useState<Record<string, ProviderRun>>({});

  async function run(providerId: VisionProviderId) {
    setRuns((current) => ({ ...current, [providerId]: { ...EMPTY_RUN, state: "running" } }));
    try {
      const settings = loadBrowserProviderSettings();
      const response = await callProvider(providerId, {
        settings,
        pdfBytes,
        filename,
        prompt,
      });
      const answer = response.outputText || "The assistant returned no text.";
      setRuns((current) => ({
        ...current,
        [providerId]: {
          state: "done",
          answer,
          error: null,
          check: checkNoticeResponse(answer, signals),
        },
      }));
    } catch (cause) {
      setRuns((current) => ({
        ...current,
        [providerId]: {
          ...EMPTY_RUN,
          state: "error",
          error: cause instanceof Error ? cause.message : "The request failed.",
        },
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="raster-guard-live-check">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="live-check-prompt">Prompt sent with the PDF</Label>
        <Textarea
          id="live-check-prompt"
          rows={2}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Written the way a student would ask. Keys come from Settings and go straight from this tab
          to the vendor.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {providers.map((providerId) => {
          const profile = getProviderProfile(providerId);
          const state = runs[providerId] ?? EMPTY_RUN;
          return (
            <div key={providerId} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{profile.label}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => run(providerId)}
                  disabled={state.state === "running"}
                  data-testid={`live-check-run-${providerId}`}
                >
                  <Play className="size-4" aria-hidden="true" />
                  {state.state === "running" ? "Uploading…" : "Upload and check"}
                </Button>
              </div>

              {state.error && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              )}

              {state.check && (
                <div className="mt-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        state.check.outcome === "surfaced"
                          ? "success"
                          : state.check.outcome === "partially_surfaced"
                            ? "warning"
                            : "destructive"
                      }
                    >
                      {state.check.matchedCount}/{state.check.total} canaries
                    </Badge>
                    <span className="text-xs text-muted-foreground">{state.check.headline}</span>
                  </div>
                  <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {state.check.matches.map((match) => (
                      <li key={match.label}>
                        {match.matched ? "matched" : "no match"} — {match.label}
                      </li>
                    ))}
                  </ul>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 font-sans text-xs text-foreground">
                    {state.answer}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function callProvider(
  providerId: VisionProviderId,
  args: {
    settings: ReturnType<typeof loadBrowserProviderSettings>;
    pdfBytes: Uint8Array;
    filename: string;
    prompt: string;
  },
): Promise<VisionCheckResponse> {
  const { settings, pdfBytes, filename, prompt } = args;

  if (providerId === "chatgpt") {
    requireKey(settings.openAiApiKey, "OpenAI");
    return callOpenAiWithPdf({
      apiKey: settings.openAiApiKey,
      model: settings.openAiModel,
      pdfBytes,
      filename,
      prompt,
    });
  }

  if (providerId === "claude") {
    requireKey(settings.anthropicApiKey, "Anthropic");
    return callClaudeWithPdf({
      apiKey: settings.anthropicApiKey,
      model: settings.anthropicModel,
      pdfBytes,
      filename,
      prompt,
    });
  }

  requireKey(settings.googleApiKey, "Google");
  return callGeminiWithPdf({
    apiKey: settings.googleApiKey,
    model: settings.googleModel,
    pdfBytes,
    filename,
    prompt,
  });
}

function requireKey(key: string, vendor: string): void {
  if (!key.trim())
    throw new Error(`Add a ${vendor} API key in Settings before running this check.`);
}
