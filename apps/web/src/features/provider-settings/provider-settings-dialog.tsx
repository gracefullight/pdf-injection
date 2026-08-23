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

  function handleClearKey() {
    clearBrowserProviderKey();
    setSettings((current) => ({ ...current, openAiApiKey: "" }));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="provider-settings-button">
          <Settings aria-hidden="true" />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Model provider settings</DialogTitle>
          <DialogDescription>
            Use your own OpenAI project key for direct browser-to-OpenAI model tests.
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="openai-api-key">OpenAI API key</Label>
          <Input
            id="openai-api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={settings.openAiApiKey}
            onChange={(event) =>
              setSettings((current) => ({ ...current, openAiApiKey: event.target.value }))
            }
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="openai-model">OpenAI model</Label>
          <Input
            id="openai-model"
            value={settings.openAiModel}
            onChange={(event) =>
              setSettings((current) => ({ ...current, openAiModel: event.target.value }))
            }
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClearKey}>
            Clear key
          </Button>
          <Button type="button" onClick={handleSave} disabled={!settings.openAiModel.trim()}>
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
