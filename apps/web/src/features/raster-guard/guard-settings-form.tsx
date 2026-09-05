import {
  ALL_VISION_PROVIDERS,
  getProviderProfile,
  type SalienceTier,
  TIER_CHANNELS,
  type VisionProviderId,
} from "@pdf-injection/raster-guard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RESOLUTION_OPTIONS } from "@/features/rasterizer/rasterizer-helpers";
import { cn } from "@/lib/utils";

export interface GuardSettings {
  tier: SalienceTier;
  providers: VisionProviderId[];
  scope: "all" | "first";
  scale: number;
}

export const TIER_COPY: Record<SalienceTier, { label: string; detail: string }> = {
  overt: {
    label: "Overt — a plain, readable footer",
    detail:
      "Ordinary dark text a student will see and can read. The highest-confidence option, and the one to use when the notice is meant to inform as much as to intercept.",
  },
  subtle: {
    label: "Subtle — quiet footer, faint watermark, margin line",
    detail:
      "Grey type where a reader expects boilerplate, plus a faint full-width watermark. Present on the page but easy to read past. The default.",
  },
  covert: {
    label: "Covert — faint watermark and edge text only",
    detail:
      "No dark type anywhere. Coverage drops to marginal on some pipelines, and the report will say so. Still visible to anyone who looks at the page closely.",
  },
};

/**
 * The three dials that change the output: how loud the notice is, which
 * ingestion pipelines it is sized for, and which pages carry it.
 */
export function GuardSettingsForm({
  settings,
  onChange,
  disabled,
}: {
  settings: GuardSettings;
  onChange: (settings: GuardSettings) => void;
  disabled?: boolean;
}) {
  function toggleProvider(id: VisionProviderId, checked: boolean) {
    const next = checked
      ? [...settings.providers, id]
      : settings.providers.filter((entry) => entry !== id);
    onChange({ ...settings, providers: next });
  }

  return (
    <Card data-testid="raster-guard-settings">
      <CardHeader>
        <CardTitle className="text-base">3. Placement</CardTitle>
        <CardDescription>
          How loudly the notice is painted, and which assistants it is sized to stay readable for.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3" disabled={disabled}>
          <legend className="text-sm font-medium text-foreground">Salience</legend>
          {(Object.keys(TIER_COPY) as SalienceTier[]).map((tier) => (
            <label
              key={tier}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition-colors",
                settings.tier === tier
                  ? "border-primary bg-accent/40"
                  : "border-border hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-foreground">
                <input
                  type="radio"
                  name="raster-guard-tier"
                  value={tier}
                  checked={settings.tier === tier}
                  onChange={() => onChange({ ...settings, tier })}
                  data-testid={`tier-${tier}`}
                />
                {TIER_COPY[tier].label}
              </span>
              <span className="pl-6 text-xs text-muted-foreground">{TIER_COPY[tier].detail}</span>
              <span className="pl-6 text-xs text-muted-foreground">
                Rungs: {TIER_CHANNELS[tier].map((channel) => channel.replace(/_/g, " ")).join(", ")}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-3" disabled={disabled}>
          <legend className="text-sm font-medium text-foreground">
            Assistants to stay readable for
          </legend>
          <p className="text-xs text-muted-foreground">
            The notice is sized from the harshest pipeline you select here. Selecting more of them
            can only make the type larger, never smaller.
          </p>
          {ALL_VISION_PROVIDERS.map((id) => {
            const profile = getProviderProfile(id);
            return (
              <div key={id} className="flex items-start gap-3">
                <Checkbox
                  id={`provider-${id}`}
                  checked={settings.providers.includes(id)}
                  onCheckedChange={(checked) => toggleProvider(id, checked === true)}
                  data-testid={`provider-${id}`}
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={`provider-${id}`} className="cursor-pointer">
                    {profile.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{profile.sourceNote}</p>
                </div>
              </div>
            );
          })}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="guard-scope">Pages</Label>
            <Select
              value={settings.scope}
              onValueChange={(value) => onChange({ ...settings, scope: value as "all" | "first" })}
              disabled={disabled}
            >
              <SelectTrigger id="guard-scope" data-testid="guard-scope-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Every page (recommended)</SelectItem>
                <SelectItem value="first">First page only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Every page survives a student uploading a single-page screenshot or an extract.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="guard-scale">Raster resolution</Label>
            <Select
              value={String(settings.scale)}
              onValueChange={(value) => onChange({ ...settings, scale: Number(value) })}
              disabled={disabled}
            >
              <SelectTrigger id="guard-scale" data-testid="guard-scale-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_OPTIONS.map((option) => (
                  <SelectItem key={option.scale} value={String(option.scale)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Higher is sharper for a human reader. It does not raise coverage on its own: every
              provider downsamples to its own ceiling regardless.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
