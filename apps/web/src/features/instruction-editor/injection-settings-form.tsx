import type { InjectionMode, PayloadLanguage, Position } from "@pdf-injection/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/ui/required-mark";
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
import { PdfStructureMap } from "@/features/instruction-editor/pdf-structure-map";
import { reachesModelInvisibly } from "@/lib/injection-anatomy";
import { isResearchProbeMode } from "@/lib/injection-modes";

/**
 * Marks the invisible channels that reached the model in the 2026-08-23 gpt-5.6-luna run
 * (white_text / render_mode_3 / acroform_field). Green dot mirrors the structure map's
 * "reaches model" legend; `title` carries the provider-specific caveat.
 */
function ReachesModelIndicator() {
  return (
    <span
      className="ml-auto inline-flex items-center pl-2"
      title="Reached gpt-5.6-luna (5/5) in the 2026-08-23 benchmark"
      data-testid="injection-mode-reaches-indicator"
    >
      <span className="size-1.5 rounded-full bg-success-foreground" />
      <span className="sr-only">reaches the model</span>
    </span>
  );
}

export interface InjectionSettingsFormProps {
  settings: InjectionSettings;
  onChange: (settings: InjectionSettings) => void;
  pageCount: number | null;
  /** Raw instruction text — used only to auto-suggest payload language when it contains non-ASCII characters. */
  instruction: string;
  /** From `useFeatures()`; when false, "ko" cannot actually be embedded server-side (no font available). */
  koPayloadAvailable: boolean;
  /** From `useFeatures()`; when false, "zh" cannot actually be embedded server-side (no font available). */
  zhPayloadAvailable: boolean;
  /** From `useFeatures()`; when false, `image_only` cannot rasterize (no `@napi-rs/canvas` on this server). */
  canvasAvailable: boolean;
  /**
   * On-device mode: there is no server at all, so the suffix on a disabled
   * option must not say "on this server" — these modes/languages need one.
   */
  localMode?: boolean;
}

export const MODE_DESCRIPTIONS: Record<InjectionMode, string> = {
  white_text:
    "White-on-white text: likely readable by text extraction, but visible if the background isn't white.",
  render_mode_3:
    "Non-rendering text (PDF Tr 3): invisible regardless of background, but some parsers may drop it.",
  visible_positive_control:
    "Visible control condition: the instruction is shown to readers; research use only, not for distribution.",
  xmp_only: "Research control: payload only in XMP metadata; not a production mode.",
  unicode_tags:
    "Zero-width Unicode Tag characters (U+E00xx) carried by an invisible text object; many pipelines strip tag characters — research channel, not a production default.",
  image_only: "Visible image stamped in the page margin; it contains no text object.",
  freetext_annot: "Invisible text stored in a PDF annotation rather than page text.",
  acroform_field: "Invisible text stored in a PDF form field rather than page text.",
  info_dict: "Stores the instruction in PDF metadata instead of page text.",
};

/** Concise labels for the additional-channels checkbox group (the mode <Select> above carries the long descriptions). */
const MODE_SHORT_LABELS: Record<InjectionMode, string> = {
  white_text: "White text",
  render_mode_3: "Render mode 3 (non-rendering)",
  visible_positive_control: "Visible positive control",
  xmp_only: "XMP metadata only",
  unicode_tags: "Unicode tags",
  image_only: "Image only (visible)",
  freetext_annot: "FreeText annotation",
  acroform_field: "AcroForm field",
  info_dict: "Info dictionary",
};

/** Order of the additional-channel checkboxes — mirrors the mode <Select>. */
const ADDITIONAL_MODE_ORDER: InjectionMode[] = [
  "white_text",
  "render_mode_3",
  "acroform_field",
  "visible_positive_control",
  "xmp_only",
  "unicode_tags",
  "image_only",
  "freetext_annot",
  "info_dict",
];

export function InjectionSettingsForm({
  settings,
  onChange,
  pageCount,
  instruction,
  koPayloadAvailable,
  zhPayloadAvailable,
  canvasAvailable,
  localMode = false,
}: InjectionSettingsFormProps) {
  const unavailableSuffix = localMode ? "(needs a server)" : "(unavailable on this server)";

  // Extra channels injected alongside the primary `mode` into the same PDF.
  // On-device only — the server path injects a single mode.
  const additionalModes = settings.additionalModes ?? [];
  function modeUnavailable(mode: InjectionMode): boolean {
    return (
      (mode === "unicode_tags" && !koPayloadAvailable) ||
      (mode === "image_only" && !canvasAvailable)
    );
  }
  function toggleAdditionalMode(mode: InjectionMode, checked: boolean) {
    update({
      additionalModes: checked
        ? [...additionalModes, mode]
        : additionalModes.filter((m) => m !== mode),
    });
  }

  // "Middle" is a shortcut for an explicit page number (the wire contract has
  // only first/last/N), so it is stored as that number and recognised again
  // here — otherwise picking it would immediately read back as "Specific page".
  const middlePage = Math.ceil((pageCount ?? 1) / 2);
  const targetPageSelectValue =
    typeof settings.targetPage === "string"
      ? settings.targetPage
      : settings.targetPage === middlePage
        ? "middle"
        : "custom";
  function update(partial: Partial<InjectionSettings>) {
    onChange({ ...settings, ...partial });
  }

  // xmp_only and info_dict write a single document-level payload with no page
  // content, so "every page" cannot repeat anything for them.
  const documentLevelMode = settings.mode === "xmp_only" || settings.mode === "info_dict";

  const instructionHasNonAscii = hasNonAsciiCharacters(instruction);
  const suggestKo = instructionHasNonAscii && settings.payloadLanguage === "en";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="injection-mode">Injection mode</Label>
        <Select
          value={settings.mode}
          onValueChange={(value) => {
            const nextMode = value as InjectionMode;
            // A channel can't be both the primary and an "additional" one — drop
            // it from the extras if the user just promoted it to primary.
            update({
              mode: nextMode,
              additionalModes: additionalModes.filter((m) => m !== nextMode),
            });
          }}
        >
          <SelectTrigger id="injection-mode" data-testid="injection-mode-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/*
              Ordering reflects the 2026-08-23 round-3 benchmark against gpt-5.6-luna:
              the three invisible channels that reached the model 5/5 are grouped first
              (white_text, render_mode_3, acroform_field), then the visible control, then
              the channels that did not reach the model in that run. This is a
              single-provider empirical ordering, not a universal ranking — see
              research/results/2026-08-23-round3-probe-modes/.
            */}
            <SelectItem value="white_text">
              White text (default)
              {reachesModelInvisibly("white_text") && <ReachesModelIndicator />}
            </SelectItem>
            <SelectItem value="render_mode_3">
              Render mode 3 (non-rendering)
              {reachesModelInvisibly("render_mode_3") && <ReachesModelIndicator />}
            </SelectItem>
            <SelectItem value="acroform_field" data-testid="injection-mode-option-acroform-field">
              AcroForm field
              {reachesModelInvisibly("acroform_field") && <ReachesModelIndicator />}
            </SelectItem>
            <SelectItem value="visible_positive_control">Visible positive control</SelectItem>
            <SelectItem value="xmp_only" data-testid="injection-mode-option-xmp-only">
              XMP metadata only (research control)
            </SelectItem>
            <SelectItem
              value="unicode_tags"
              disabled={!koPayloadAvailable}
              data-testid="injection-mode-option-unicode-tags"
            >
              Unicode tags (research) {koPayloadAvailable ? "" : unavailableSuffix}
            </SelectItem>
            <SelectItem
              value="image_only"
              disabled={!canvasAvailable}
              data-testid="injection-mode-option-image-only"
            >
              Image only (visible) {canvasAvailable ? "" : unavailableSuffix}
            </SelectItem>
            <SelectItem value="freetext_annot" data-testid="injection-mode-option-freetext-annot">
              FreeText annotation
            </SelectItem>
            <SelectItem value="info_dict" data-testid="injection-mode-option-info-dict">
              Info dictionary
            </SelectItem>
          </SelectContent>
        </Select>
        <PdfStructureMap mode={settings.mode} />
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground" data-testid="injection-mode-description">
            {MODE_DESCRIPTIONS[settings.mode]}
          </p>
          {isResearchProbeMode(settings.mode) && (
            <Badge variant="warning" data-testid="injection-mode-research-probe-badge">
              Experimental
            </Badge>
          )}
          {settings.mode === "image_only" && (
            <Badge variant="secondary" data-testid="injection-mode-visible-badge">
              Visible by design
            </Badge>
          )}
        </div>
        {settings.mode === "xmp_only" && (
          <Alert variant="warning" data-testid="injection-mode-xmp-only-caveat">
            <AlertDescription>
              Research control: payload only in XMP metadata; not a production mode.
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "unicode_tags" && (
          <Alert variant="warning" data-testid="injection-mode-unicode-tags-caveat">
            <AlertDescription>
              Zero-width Unicode Tag characters (U+E00xx) carried by an invisible text object; many
              pipelines strip tag characters — research channel, not a production default. Survival
              under real providers is unproven; this mode exists to measure it, not to guarantee it.
              {!koPayloadAvailable &&
                " Unicode tags is currently unavailable on this server (same font dependency as Korean payload)."}
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "image_only" && (
          <Alert variant="warning" data-testid="injection-mode-image-only-caveat">
            <AlertDescription>
              This mode rasterizes the instruction as a visible image in the page margin. Use it to
              test whether a document reader processes images. Because no text object is written,
              the Extracted Text tab will remain empty.
              {!canvasAvailable &&
                " Image only is currently unavailable on this server (the native canvas dependency is missing)."}
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "freetext_annot" && (
          <Alert variant="warning" data-testid="injection-mode-freetext-annot-caveat">
            <AlertDescription>
              This mode stores invisible text in a FreeText annotation. The Extracted Text tab will
              not show it, although some PDF readers may still extract annotation content.
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "acroform_field" && (
          <Alert variant="warning" data-testid="injection-mode-acroform-field-caveat">
            <AlertDescription>
              This mode stores invisible text in an AcroForm field. The Extracted Text tab will not
              show it, although form-aware PDF readers may still find the field value.
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "info_dict" && (
          <Alert variant="warning" data-testid="injection-mode-info-dict-caveat">
            <AlertDescription>
              This mode stores the instruction only in PDF metadata, not on a page. It will not
              appear in Extracted Text. Use it only when testing software that reads document
              metadata. The original document title stays unchanged.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {localMode && (
        <div className="flex flex-col gap-1.5" data-testid="additional-channels">
          <Label>Also inject these channels (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Add one or more channels to embed alongside the primary mode above. Every selected
            channel is injected into the same PDF — e.g. Render mode 3 plus AcroForm field writes
            both an invisible page-text object and a hidden form-field payload. On-device only.
          </p>
          <div className="flex flex-col gap-2">
            {ADDITIONAL_MODE_ORDER.filter((mode) => mode !== settings.mode).map((mode) => {
              const disabled = modeUnavailable(mode);
              const checkboxId = `additional-mode-${mode.replace(/_/g, "-")}`;
              return (
                <div key={mode} className="flex items-center gap-2">
                  <Checkbox
                    id={checkboxId}
                    checked={additionalModes.includes(mode)}
                    disabled={disabled}
                    onCheckedChange={(checked) => toggleAdditionalMode(mode, checked === true)}
                    data-testid={`${checkboxId}-checkbox`}
                  />
                  <Label htmlFor={checkboxId} className="font-normal">
                    {MODE_SHORT_LABELS[mode]}
                    {disabled ? ` ${unavailableSuffix}` : ""}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
              Korean {koPayloadAvailable ? "" : unavailableSuffix}
            </SelectItem>
            <SelectItem
              value="zh"
              disabled={!zhPayloadAvailable}
              data-testid="payload-language-option-zh"
            >
              Chinese {zhPayloadAvailable ? "" : unavailableSuffix}
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {settings.payloadLanguage === "en"
            ? "English payload uses printable ASCII only. Non-ASCII characters will be rejected at generation time."
            : settings.payloadLanguage === "ko"
              ? "Korean payload embeds a CJK font subset (Noto Sans KR) so non-ASCII text can be drawn."
              : "Chinese payload embeds a Simplified-Chinese CJK font subset (Noto Sans SC) so non-ASCII text can be drawn."}
        </p>
        {suggestKo && (
          <Alert data-testid="payload-language-ko-suggestion">
            <AlertDescription>
              The instruction contains non-ASCII characters. Switch payload language to Korean or
              Chinese, or the "en" payload language will reject it at generation time.
              {!koPayloadAvailable &&
                !zhPayloadAvailable &&
                " Both Korean and Chinese payload are currently unavailable on this server."}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="target-page">
            Target page
            <RequiredMark />
          </Label>
          <Select
            value={targetPageSelectValue}
            onValueChange={(value) =>
              update({
                targetPage:
                  value === "middle"
                    ? middlePage
                    : value === "custom"
                      ? (pageCount ?? 1)
                      : (value as "first" | "last" | "all"),
              })
            }
          >
            <SelectTrigger id="target-page" data-testid="target-page-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="first">First page (default)</SelectItem>
              <SelectItem value="middle" data-testid="target-page-option-middle">
                Middle page{pageCount ? ` (${middlePage})` : ""}
              </SelectItem>
              <SelectItem value="last">Last page</SelectItem>
              <SelectItem value="all" data-testid="target-page-option-all">
                Every page{pageCount ? ` (${pageCount})` : ""}
              </SelectItem>
              <SelectItem value="custom">Specific page…</SelectItem>
            </SelectContent>
          </Select>
          {settings.targetPage === "all" && (
            <p className="text-xs text-muted-foreground" data-testid="target-page-all-note">
              {documentLevelMode
                ? "This mode stores one document-level payload, so it is written once no matter how many pages the document has."
                : `The instruction is repeated on every page${pageCount ? ` (${pageCount})` : ""}. It survives page reordering or an excerpt being submitted, but every copy is one more chance for a reader to notice it.`}
            </p>
          )}
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
              <SelectItem value="top">Top margin (default)</SelectItem>
              <SelectItem value="bottom">Bottom margin</SelectItem>
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
