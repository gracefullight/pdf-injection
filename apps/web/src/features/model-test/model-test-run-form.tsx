import type { BenchmarkCondition, ModelTestRequest, ProviderName } from "@pdf-injection/contracts";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
  ALL_BENCHMARK_CONDITIONS,
  DEFAULT_OUTER_PROMPT,
  isLocalProvider,
  MAX_REPEATS,
  MIN_REPEATS,
  providerAvailability,
} from "@/features/model-test/model-test-helpers";
import type { Features } from "@/lib/features";
import { isResearchProbeMode } from "@/lib/injection-modes";

export interface ModelTestRunFormProps {
  features: Features;
  onRun: (request: ModelTestRequest) => void;
  submitting: boolean;
  error: string | null;
}

const PROVIDER_OPTIONS: ProviderName[] = ["mock", "ollama", "anthropic", "openai"];

/** Real provider display names — CSS `capitalize` mangled "openai" into "Openai" (r11 review M-15). */
const PROVIDER_LABELS: Record<ProviderName, string> = {
  mock: "Mock (local simulation)",
  ollama: "Ollama (local)",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export const CONDITION_LABELS: Record<BenchmarkCondition, string> = {
  original: "Original (untouched source)",
  white_text: "White text",
  render_mode_3: "Render mode 3",
  visible_positive_control: "Visible positive control",
  xmp_only: "XMP metadata only",
  unicode_tags: "Unicode tags (research)",
  image_only: "Image only (visible)",
  freetext_annot: "FreeText annotation",
  acroform_field: "AcroForm field",
  info_dict: "PDF metadata",
  actual_text: "ActualText semantics (research)",
};

export function ModelTestRunForm({ features, onRun, submitting, error }: ModelTestRunFormProps) {
  // Default provider selection: Ollama when detected on this machine, else Mock (contract
  // addendum §6). `features.ollama.available` isn't known synchronously on first render (it
  // comes from the health query), so this effect upgrades the initial ["mock"] default to
  // ["ollama"] once health resolves — but only if the user hasn't already touched the
  // selection themselves.
  const userTouchedProvidersRef = useRef(false);
  const [selectedProviders, setSelectedProviders] = useState<ProviderName[]>(["mock"]);
  useEffect(() => {
    if (userTouchedProvidersRef.current || !features.ollama.available) return;
    setSelectedProviders((prev) => (prev.length === 1 && prev[0] === "mock" ? ["ollama"] : prev));
  }, [features.ollama.available]);
  const [modelIds, setModelIds] = useState<Partial<Record<ProviderName, string>>>({});
  const [conditions, setConditions] = useState<BenchmarkCondition[]>(ALL_BENCHMARK_CONDITIONS);
  const [repeats, setRepeats] = useState(1);
  const [outerPrompt, setOuterPrompt] = useState(DEFAULT_OUTER_PROMPT);

  // Non-local providers (anthropic/openai) require external-transfer consent; it's granted
  // implicitly by selecting the provider (PRD FR-20: env gate + explicit provider selection is
  // the opt-in) rather than via a separate acknowledgement checkbox.
  const needsAcknowledgement = selectedProviders.some((provider) => !isLocalProvider(provider));
  const canRun = selectedProviders.length > 0 && conditions.length > 0;

  function toggleProvider(provider: ProviderName, checked: boolean) {
    userTouchedProvidersRef.current = true;
    setSelectedProviders((prev) =>
      checked ? [...prev, provider] : prev.filter((p) => p !== provider),
    );
  }

  function toggleCondition(condition: BenchmarkCondition, checked: boolean) {
    setConditions((prev) => (checked ? [...prev, condition] : prev.filter((c) => c !== condition)));
  }

  function handleSubmit() {
    if (!canRun) return;
    const providersPayload = selectedProviders.map((name) => {
      const defaultModel =
        name === "ollama" && features.ollama.models.length > 0
          ? features.ollama.models[0]
          : undefined;
      const model = (modelIds[name] ?? defaultModel)?.trim();
      return model ? { name, model } : { name };
    });
    const request: ModelTestRequest = {
      providers: providersPayload,
      conditions: conditions.length === ALL_BENCHMARK_CONDITIONS.length ? "all" : conditions,
      repeats,
      outerPrompt: outerPrompt.trim() || undefined,
      acknowledgeExternalTransfer: needsAcknowledgement,
    };
    onRun(request);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="model-test-run-form">
      <Alert data-testid="model-test-privacy-warning">
        <AlertTitle>Before you run a model test</AlertTitle>
        <AlertDescription>
          Selecting Anthropic or OpenAI sends the PDF and its hidden instruction to that provider
          over the network. Mock and Ollama (local) never leave this machine: Mock is a
          deterministic local simulation, and Ollama runs entirely on this server.
        </AlertDescription>
      </Alert>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Providers</legend>
        {PROVIDER_OPTIONS.map((provider) => {
          const { available, reason } = providerAvailability(provider, features);
          const checked = selectedProviders.includes(provider);
          return (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`model-test-provider-${provider}`}
                  data-testid={`model-test-provider-${provider}`}
                  checked={checked}
                  disabled={!available}
                  onCheckedChange={(value) => toggleProvider(provider, value === true)}
                />
                <Label htmlFor={`model-test-provider-${provider}`} className="font-normal">
                  {PROVIDER_LABELS[provider]}
                </Label>
                {checked &&
                  available &&
                  (provider === "ollama" ? (
                    features.ollama.models.length > 0 ? (
                      <Select
                        value={modelIds.ollama ?? features.ollama.models[0]}
                        onValueChange={(value) =>
                          setModelIds((prev) => ({ ...prev, ollama: value }))
                        }
                      >
                        <SelectTrigger
                          className="ml-2 h-8 max-w-56"
                          data-testid="model-test-provider-ollama-model-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {features.ollama.models.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="ml-2 h-8 max-w-56"
                        placeholder="model id (e.g. llama3.1)"
                        data-testid="model-test-provider-ollama-model-input"
                        value={modelIds.ollama ?? ""}
                        onChange={(event) =>
                          setModelIds((prev) => ({ ...prev, ollama: event.target.value }))
                        }
                      />
                    )
                  ) : (
                    <Input
                      className="ml-2 h-8 max-w-56"
                      placeholder="model id (optional)"
                      data-testid={`model-test-provider-${provider}-model-input`}
                      value={modelIds[provider] ?? ""}
                      onChange={(event) =>
                        setModelIds((prev) => ({ ...prev, [provider]: event.target.value }))
                      }
                    />
                  ))}
              </div>
              {!available && reason && (
                <p
                  className="pl-6 text-xs text-muted-foreground"
                  data-testid={`model-test-provider-${provider}-reason`}
                >
                  {reason}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">Conditions</legend>
        <div className="flex flex-wrap gap-3">
          {ALL_BENCHMARK_CONDITIONS.map((condition) => (
            <div key={condition} className="flex items-center gap-2">
              <Checkbox
                id={`model-test-condition-${condition}`}
                data-testid={`model-test-condition-${condition}`}
                checked={conditions.includes(condition)}
                onCheckedChange={(value) => toggleCondition(condition, value === true)}
              />
              <Label htmlFor={`model-test-condition-${condition}`} className="font-normal">
                {CONDITION_LABELS[condition]}
              </Label>
              {condition !== "original" && isResearchProbeMode(condition) && (
                <Badge variant="warning" data-testid={`model-test-condition-${condition}-badge`}>
                  Experimental
                </Badge>
              )}
            </div>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="model-test-repeats">Repeats</Label>
          <Input
            id="model-test-repeats"
            type="number"
            min={MIN_REPEATS}
            max={MAX_REPEATS}
            value={repeats}
            data-testid="model-test-repeats-input"
            onChange={(event) => {
              const parsed = Number(event.target.value) || MIN_REPEATS;
              setRepeats(Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, parsed)));
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="model-test-outer-prompt">Outer prompt</Label>
        <Textarea
          id="model-test-outer-prompt"
          rows={3}
          value={outerPrompt}
          data-testid="model-test-outer-prompt-textarea"
          onChange={(event) => setOuterPrompt(event.target.value)}
        />
      </div>

      {error && (
        <Alert variant="destructive" data-testid="model-test-run-error">
          <AlertTitle>Could not start the run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canRun || submitting}
          data-testid="model-test-run-button"
        >
          {submitting ? "Starting…" : "Run model test"}
        </Button>
      </div>
    </div>
  );
}
