import type { BenchmarkCondition, ModelTestRequest, ProviderName } from "@pdf-injection/contracts";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ALL_BENCHMARK_CONDITIONS,
  DEFAULT_OUTER_PROMPT,
  MAX_REPEATS,
  MIN_REPEATS,
  providerAvailability,
} from "@/features/model-test/model-test-helpers";
import type { Features } from "@/lib/features";

export interface ModelTestRunFormProps {
  features: Features;
  onRun: (request: ModelTestRequest) => void;
  submitting: boolean;
  error: string | null;
}

const PROVIDER_OPTIONS: ProviderName[] = ["mock", "anthropic", "openai"];

/** Real provider display names — CSS `capitalize` mangled "openai" into "Openai" (r11 review M-15). */
const PROVIDER_LABELS: Record<ProviderName, string> = {
  mock: "Mock (local simulation)",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const CONDITION_LABELS: Record<BenchmarkCondition, string> = {
  original: "Original (untouched source)",
  white_text: "White text",
  render_mode_3: "Render mode 3",
  visible_positive_control: "Visible positive control",
  xmp_only: "XMP metadata only",
};

export function ModelTestRunForm({ features, onRun, submitting, error }: ModelTestRunFormProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<ProviderName[]>(["mock"]);
  const [modelIds, setModelIds] = useState<Partial<Record<ProviderName, string>>>({});
  const [conditions, setConditions] = useState<BenchmarkCondition[]>(ALL_BENCHMARK_CONDITIONS);
  const [repeats, setRepeats] = useState(1);
  const [outerPrompt, setOuterPrompt] = useState(DEFAULT_OUTER_PROMPT);

  const needsAcknowledgement = selectedProviders.some((provider) => provider !== "mock");
  const canRun =
    selectedProviders.length > 0 &&
    conditions.length > 0 &&
    (!needsAcknowledgement || acknowledged);

  function toggleProvider(provider: ProviderName, checked: boolean) {
    setSelectedProviders((prev) =>
      checked ? [...prev, provider] : prev.filter((p) => p !== provider),
    );
  }

  function toggleCondition(condition: BenchmarkCondition, checked: boolean) {
    setConditions((prev) => (checked ? [...prev, condition] : prev.filter((c) => c !== condition)));
  }

  function handleSubmit() {
    if (!canRun) return;
    const request: ModelTestRequest = {
      providers: selectedProviders.map((name) => {
        const model = modelIds[name]?.trim();
        return model ? { name, model } : { name };
      }),
      conditions: conditions.length === ALL_BENCHMARK_CONDITIONS.length ? "all" : conditions,
      repeats,
      outerPrompt: outerPrompt.trim() || undefined,
      acknowledgeExternalTransfer: needsAcknowledgement ? acknowledged : false,
    };
    onRun(request);
  }

  return (
    <div className="flex flex-col gap-4" data-testid="model-test-run-form">
      <Alert data-testid="model-test-privacy-warning">
        <AlertTitle>Before you run a model test</AlertTitle>
        <AlertDescription>
          For any provider other than "mock", the PDF and its hidden instruction will be sent to
          that provider over the network. The "mock" provider never leaves this machine: it is a
          deterministic local simulation, not a real model call.
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
                {checked && available && (
                  <Input
                    className="ml-2 h-8 max-w-56"
                    placeholder="model id (optional)"
                    data-testid={`model-test-provider-${provider}-model-input`}
                    value={modelIds[provider] ?? ""}
                    onChange={(event) =>
                      setModelIds((prev) => ({ ...prev, [provider]: event.target.value }))
                    }
                  />
                )}
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

      {needsAcknowledgement && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="model-test-acknowledge"
            data-testid="model-test-acknowledge-checkbox"
            checked={acknowledged}
            onCheckedChange={(value) => setAcknowledged(value === true)}
          />
          <Label htmlFor="model-test-acknowledge" className="font-normal">
            I understand the PDF and hidden instruction will be sent to the selected external
            provider(s).
          </Label>
        </div>
      )}

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
