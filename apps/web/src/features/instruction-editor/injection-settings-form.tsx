import type { InjectionMode, PayloadLanguage, Position } from "@pdf-injection/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasNonAsciiCharacters,
  type InjectionSettings,
} from "@/features/instruction-editor/instruction-types";

export interface InjectionSettingsFormProps {
  settings: InjectionSettings;
  onChange: (settings: InjectionSettings) => void;
  pageCount: number | null;
  /** Raw instruction text — used only to auto-suggest payload language when it contains non-ASCII characters. */
  instruction: string;
  /** From `useFeatures()`; when false, "ko" cannot actually be embedded server-side (no font available). */
  koPayloadAvailable: boolean;
}

const MODE_DESCRIPTIONS: Record<InjectionMode, string> = {
  white_text:
    "White-on-white text: likely readable by text extraction, but visible if the background isn't white.",
  render_mode_3:
    "Non-rendering text (PDF Tr 3): invisible regardless of background, but some parsers may drop it.",
  visible_positive_control:
    "Visible control condition: the instruction is shown to readers; research use only, not for distribution.",
  xmp_only: "Research control: payload only in XMP metadata; not a production mode.",
};

export function InjectionSettingsForm({
  settings,
  onChange,
  pageCount,
  instruction,
  koPayloadAvailable,
}: InjectionSettingsFormProps) {
  function update(partial: Partial<InjectionSettings>) {
    onChange({ ...settings, ...partial });
  }

  const instructionHasNonAscii = hasNonAsciiCharacters(instruction);
  const suggestKo = instructionHasNonAscii && settings.payloadLanguage === "en";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="injection-mode">Injection mode</Label>
        <Select
          value={settings.mode}
          onValueChange={(value) => update({ mode: value as InjectionMode })}
        >
          <SelectTrigger id="injection-mode" data-testid="injection-mode-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="white_text">White text (default)</SelectItem>
            <SelectItem value="render_mode_3">Render mode 3 (non-rendering)</SelectItem>
            <SelectItem value="visible_positive_control">Visible positive control</SelectItem>
            <SelectItem value="xmp_only" data-testid="injection-mode-option-xmp-only">
              XMP metadata only (research control)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground" data-testid="injection-mode-description">
          {MODE_DESCRIPTIONS[settings.mode]}
        </p>
        {settings.mode === "xmp_only" && (
          <Alert variant="warning" data-testid="injection-mode-xmp-only-caveat">
            <AlertDescription>
              Research control: payload only in XMP metadata; not a production mode.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="payload-language">Payload language</Label>
        <Select
          value={settings.payloadLanguage}
          onValueChange={(value) => update({ payloadLanguage: value as PayloadLanguage })}
        >
          <SelectTrigger id="payload-language" data-testid="payload-language-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English (default)</SelectItem>
            <SelectItem
              value="ko"
              disabled={!koPayloadAvailable}
              data-testid="payload-language-option-ko"
            >
              Korean {koPayloadAvailable ? "" : "(unavailable on this server)"}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {settings.payloadLanguage === "en"
            ? "English payload uses printable ASCII only. Non-ASCII characters will be rejected at generation time."
            : "Korean payload embeds a CJK font subset (Noto Sans KR) so non-ASCII text can be drawn."}
        </p>
        {suggestKo && (
          <Alert data-testid="payload-language-ko-suggestion">
            <AlertDescription>
              The instruction contains non-ASCII characters. Switch payload language to Korean, or
              the "en" payload language will reject it at generation time.
              {!koPayloadAvailable && " Korean payload is currently unavailable on this server."}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target-page">Target page</Label>
          <Select
            value={typeof settings.targetPage === "string" ? settings.targetPage : "custom"}
            onValueChange={(value) =>
              update({
                targetPage: value === "custom" ? (pageCount ?? 1) : (value as "first" | "last"),
              })
            }
          >
            <SelectTrigger id="target-page" data-testid="target-page-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">First page</SelectItem>
              <SelectItem value="last">Last page (default)</SelectItem>
              <SelectItem value="custom">Specific page…</SelectItem>
            </SelectContent>
          </Select>
          {typeof settings.targetPage === "number" && (
            <Input
              type="number"
              min={1}
              max={pageCount ?? undefined}
              value={settings.targetPage}
              onChange={(event) => update({ targetPage: Number(event.target.value) || 1 })}
              data-testid="target-page-number-input"
              aria-label="Target page number"
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="position">Position</Label>
          <Select
            value={settings.position}
            onValueChange={(value) => update({ position: value as Position })}
          >
            <SelectTrigger id="position" data-testid="position-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top margin</SelectItem>
              <SelectItem value="bottom">Bottom margin (default)</SelectItem>
              <SelectItem value="custom">Custom coordinates</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {settings.position === "custom" && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="position-x">X (pt)</Label>
              <Input
                id="position-x"
                type="number"
                value={settings.x ?? 0}
                onChange={(event) => update({ x: Number(event.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="position-y">Y (pt)</Label>
              <Input
                id="position-y"
                type="number"
                value={settings.y ?? 0}
                onChange={(event) => update({ y: Number(event.target.value) })}
              />
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="font-size">Font size (pt)</Label>
          <Input
            id="font-size"
            type="number"
            min={0.5}
            max={12}
            step={0.5}
            value={settings.fontSize}
            disabled={settings.mode === "visible_positive_control"}
            onChange={(event) => update({ fontSize: Number(event.target.value) || 1 })}
            data-testid="font-size-input"
          />
          {settings.mode === "visible_positive_control" && (
            <p className="text-xs text-muted-foreground">
              Visible positive control always uses 9pt.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="max-width">Maximum width (pt, optional)</Label>
          <Input
            id="max-width"
            type="number"
            value={settings.maxWidth ?? ""}
            onChange={(event) =>
              update({ maxWidth: event.target.value ? Number(event.target.value) : undefined })
            }
          />
        </div>
      </div>
    </div>
  );
}
