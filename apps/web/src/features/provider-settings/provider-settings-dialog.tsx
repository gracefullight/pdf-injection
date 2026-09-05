import { Info, KeyRound, Settings } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearBrowserProviderKey,
  loadBrowserProviderSettings,
  saveBrowserProviderSettings,
} from "@/lib/browser-provider-settings";

/**
 * One row per vendor. OpenAI drives the Model Test tab; all three drive Raster
 * Guard's live check, which uploads a guarded PDF straight from this tab.
 */
const VENDOR_FIELDS: {
  id: string;
  label: string;
  keyField: "openAiApiKey" | "anthropicApiKey" | "googleApiKey";
  modelField: "openAiModel" | "anthropicModel" | "googleModel";
  keyPlaceholder: string;
  modelHint: string;
}[] = [
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    keyField: "openAiApiKey",
    modelField: "openAiModel",
    keyPlaceholder: "sk-…",
    modelHint: "Used by the Model Test tab and by Raster Guard's live check.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyField: "anthropicApiKey",
    modelField: "anthropicModel",
    keyPlaceholder: "sk-ant-…",
    modelHint:
      "Raster Guard live check only. Browser calls need a key allowed for direct browser access.",
  },
  {
    id: "google",
    label: "Google (Gemini)",
    keyField: "googleApiKey",
    modelField: "googleModel",
    keyPlaceholder: "AIza…",
    modelHint:
      "Raster Guard live check only. Edit the model name if your key targets a different one.",
  },
];

export function ProviderSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadBrowserProviderSettings);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) setSettings(loadBrowserProviderSettings());
  }

  function handleSave() {
    saveBrowserProviderSettings(settings);
    setOpen(false);
  }

  function handleClearKeys() {
    clearBrowserProviderKey();
    setSettings((current) => ({
      ...current,
      openAiApiKey: "",
      anthropicApiKey: "",
      googleApiKey: "",
    }));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="provider-settings-button">
          <Settings aria-hidden="true" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Model provider settings</DialogTitle>
          <DialogDescription>
            Use your own vendor keys for direct browser-to-provider tests. Keys stay in this tab.
          </DialogDescription>
        </DialogHeader>

        <Alert data-testid="provider-settings-scoring-note">
          <Info aria-hidden="true" />
          <AlertTitle>What a model test checks</AlertTitle>
          <AlertDescription>
            A model test sends the injected PDF (and the untouched original) to the provider with
            the same outer prompt, then scores each answer against the job's expected signals — the
            phrases, labels or term orders you defined in step 2. Signals are optional for
            generating the PDF but required for this scoring, and they are frozen into the job when
            it is generated: a job created without signals cannot be scored, only regenerated.
          </AlertDescription>
        </Alert>

        <Alert variant="warning">
          <KeyRound aria-hidden="true" />
          <AlertTitle>Browser BYOK mode</AlertTitle>
          <AlertDescription>
            The key is kept in this tab's sessionStorage and is removed when the tab session ends.
            Page scripts can still access sessionStorage, so use a project-scoped key with a low
            usage limit and revoke it after use.
          </AlertDescription>
        </Alert>

        {VENDOR_FIELDS.map((vendor) => (
          <div key={vendor.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium text-foreground">{vendor.label}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${vendor.id}-api-key`}>API key</Label>
              <Input
                id={`${vendor.id}-api-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={vendor.keyPlaceholder}
                value={settings[vendor.keyField]}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, [vendor.keyField]: event.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${vendor.id}-model`}>Model</Label>
              <Input
                id={`${vendor.id}-model`}
                value={settings[vendor.modelField]}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    [vendor.modelField]: event.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">{vendor.modelHint}</p>
            </div>
          </div>
        ))}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClearKeys}>
            Clear all keys
          </Button>
          <Button type="button" onClick={handleSave} disabled={!settings.openAiModel.trim()}>
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
