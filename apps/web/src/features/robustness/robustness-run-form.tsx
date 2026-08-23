import type {
  ModelTestRunListItem,
  PdfTransform,
  ProviderName,
  RobustnessRequest,
  TextTransform,
} from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_PDF_TRANSFORMS,
  ALL_TEXT_TRANSFORMS,
  isLocalProvider,
  parseCustomTexts,
  pdfTransformAvailability,
  providerAvailability,
} from "@/features/robustness/robustness-helpers";
import type { Features } from "@/lib/features";
import { formatDateTime } from "@/lib/format-date";

export interface RobustnessRunFormProps {
  features: Features;
  modelTestRuns: ModelTestRunListItem[];
  onRun: (request: RobustnessRequest) => void;
  submitting: boolean;
  error: string | null;
  /** Text transforms score expected-signal survival; disable them when the job has no signals. */
  textTransformsDisabled?: boolean;
}

const PDF_TRANSFORM_LABELS: Record<PdfTransform, string> = {
  print_to_pdf: "Print to PDF",
  ocr_regeneration: "OCR regeneration",
  screenshot_ocr: "Screenshot OCR",
};

const TEXT_TRANSFORM_LABELS: Record<TextTransform, string> = {
  paraphrase: "Paraphrase",
  translation: "Translation",
  human_edit: "Human edit",
};

const PROVIDER_OPTIONS: ProviderName[] = ["mock", "ollama", "anthropic", "openai"];

type TextSourceKind = "model_test_run" | "custom";

export function RobustnessRunForm({
  features,
  modelTestRuns,
  onRun,
  submitting,
  error,
  textTransformsDisabled = false,
}: RobustnessRunFormProps) {
  const [pdfTransforms, setPdfTransforms] = useState<PdfTransform[]>([]);
  const [textTransforms, setTextTransforms] = useState<TextTransform[]>([]);
  const [provider, setProvider] = useState<ProviderName>("mock");
  const [sourceKind, setSourceKind] = useState<TextSourceKind>("custom");
  const [customTexts, setCustomTexts] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [seed, setSeed] = useState("");

  // Non-local providers (anthropic/openai) require external-transfer consent; it's granted
  // implicitly by selecting the provider rather than via a separate acknowledgement checkbox
  // (contract addendum §6 — same rule as the model-test tab).
  const needsAcknowledgement = textTransforms.length > 0 && !isLocalProvider(provider);
  const parsedCustomTexts = parseCustomTexts(customTexts);
  const hasValidTextSource =
    textTransforms.length === 0 ||
    (sourceKind === "custom" ? parsedCustomTexts.length > 0 : selectedRunId.length > 0);
  const canRun = (pdfTransforms.length > 0 || textTransforms.length > 0) && hasValidTextSource;

  function togglePdfTransform(transform: PdfTransform, checked: boolean) {
    setPdfTransforms((prev) =>
      checked ? [...prev, transform] : prev.filter((t) => t !== transform),
    );
  }

  function toggleTextTransform(transform: TextTransform, checked: boolean) {
    setTextTransforms((prev) =>
      checked ? [...prev, transform] : prev.filter((t) => t !== transform),
    );
  }

  function handleSubmit() {
    if (!canRun) return;
    const request: RobustnessRequest = {
      pdfTransforms,
      textTransforms,
      textSource:
        sourceKind === "custom"
          ? { kind: "custom", texts: parsedCustomTexts.length > 0 ? parsedCustomTexts : [""] }
          : { kind: "model_test_run", runId: selectedRunId },
      providers: textTransforms.length > 0 ? [{ name: provider }] : [],
      repeats: 1,
      seed: seed.trim() || undefined,
      acknowledgeExternalTransfer: needsAcknowledgement,
    };
    onRun(request);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="robustness-run-form">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">PDF transforms</legend>
        {ALL_PDF_TRANSFORMS.map((transform) => {
          const { available, reason } = pdfTransformAvailability(transform, features);
          return (
            <div key={transform} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`robustness-pdf-transform-${transform}`}
                  data-testid={`robustness-pdf-transform-${transform}`}
                  checked={pdfTransforms.includes(transform)}
                  disabled={!available}
                  onCheckedChange={(value) => togglePdfTransform(transform, value === true)}
                />
                <Label htmlFor={`robustness-pdf-transform-${transform}`} className="font-normal">
                  {PDF_TRANSFORM_LABELS[transform]}
                </Label>
              </div>
              {!available && reason && (
                <p
                  className="pl-6 text-xs text-muted-foreground"
                  data-testid={`robustness-pdf-transform-${transform}-reason`}
                >
                  {reason}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Text transforms</legend>
        {textTransformsDisabled && (
          <p className="text-xs text-muted-foreground">
            Unavailable: text transforms measure whether expected signals survive, and this job has
            none.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {ALL_TEXT_TRANSFORMS.map((transform) => (
            <div key={transform} className="flex items-center gap-2">
              <Checkbox
                id={`robustness-text-transform-${transform}`}
                data-testid={`robustness-text-transform-${transform}`}
                disabled={textTransformsDisabled}
                checked={textTransforms.includes(transform)}
                onCheckedChange={(value) => toggleTextTransform(transform, value === true)}
              />
              <Label htmlFor={`robustness-text-transform-${transform}`} className="font-normal">
                {TEXT_TRANSFORM_LABELS[transform]}
              </Label>
            </div>
          ))}
        </div>

        {textTransforms.length > 0 && (
          <>
            <Alert data-testid="robustness-privacy-warning">
              <AlertTitle>Before you run a transform with a provider</AlertTitle>
              <AlertDescription>
                Selecting Anthropic or OpenAI sends the sample text to that provider over the
                network. Mock and Ollama (local) never leave this machine: Mock is a deterministic
                local simulation, and Ollama runs entirely on this server.
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="robustness-provider">Provider (paraphrase/translation)</Label>
              <Select
                value={provider}
                onValueChange={(value) => setProvider(value as ProviderName)}
              >
                <SelectTrigger id="robustness-provider" data-testid="robustness-provider-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((option) => {
                    const { available, reason } = providerAvailability(option, features);
                    return (
                      <SelectItem
                        key={option}
                        value={option}
                        disabled={!available}
                        data-testid={`robustness-provider-option-${option}`}
                      >
                        {option} {available ? "" : `(${reason})`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {provider === "mock" && (
                <p className="text-xs text-muted-foreground">
                  Translation has no mock implementation. It is only available when a real provider
                  is configured.
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-foreground">Text source</legend>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-normal">
                  <input
                    type="radio"
                    name="robustness-text-source"
                    checked={sourceKind === "custom"}
                    onChange={() => setSourceKind("custom")}
                    data-testid="robustness-text-source-custom-radio"
                  />
                  Custom text
                </label>
                <label className="flex items-center gap-2 text-sm font-normal">
                  <input
                    type="radio"
                    name="robustness-text-source"
                    checked={sourceKind === "model_test_run"}
                    onChange={() => setSourceKind("model_test_run")}
                    data-testid="robustness-text-source-run-radio"
                  />
                  From a completed model-test run
                </label>
              </div>

              {sourceKind === "custom" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="robustness-custom-texts" required>
                    Custom text
                  </Label>
                  <Textarea
                    id="robustness-custom-texts"
                    rows={4}
                    placeholder="One sample per line"
                    value={customTexts}
                    onChange={(event) => setCustomTexts(event.target.value)}
                    data-testid="robustness-custom-texts-textarea"
                    aria-required="true"
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="robustness-text-source-run-select" required>
                    Model-test run
                  </Label>
                  <Select value={selectedRunId} onValueChange={setSelectedRunId}>
                    <SelectTrigger
                      id="robustness-text-source-run-select"
                      aria-required="true"
                      data-testid="robustness-text-source-run-select"
                    >
                      <SelectValue placeholder="Select a model-test run" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelTestRuns
                        .filter((run) => run.status === "completed")
                        .map((run) => (
                          <SelectItem key={run.runId} value={run.runId}>
                            {run.runId.slice(0, 8)} ({formatDateTime(run.createdAt)})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </fieldset>
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="robustness-seed">Seed (optional)</Label>
        <Input
          id="robustness-seed"
          value={seed}
          onChange={(event) => setSeed(event.target.value)}
          data-testid="robustness-seed-input"
        />
      </div>

      {error && (
        <Alert variant="destructive" data-testid="robustness-run-error">
          <AlertTitle>Could not start the run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canRun || submitting}
          data-testid="robustness-run-button"
        >
          {submitting ? "Starting…" : "Run robustness test"}
        </Button>
      </div>
    </div>
  );
}
