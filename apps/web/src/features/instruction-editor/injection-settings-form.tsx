import type { InjectionMode, PayloadLanguage, Position } from "@pdf-injection/contracts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { PdfStructureMap } from "@/features/instruction-editor/pdf-structure-map";
import { isResearchProbeMode } from "@/lib/injection-modes";

export interface InjectionSettingsFormProps {
  settings: InjectionSettings;
  onChange: (settings: InjectionSettings) => void;
  pageCount: number | null;
  /** Raw instruction text — used only to auto-suggest payload language when it contains non-ASCII characters. */
  instruction: string;
  /** From `useFeatures()`; when false, "ko" cannot actually be embedded server-side (no font available). */
  koPayloadAvailable: boolean;
  /** From `useFeatures()`; when false, `image_only` cannot rasterize (no `@napi-rs/canvas` on this server). */
  canvasAvailable: boolean;
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
  image_only:
    "Round-3 diagnostic probe, visible by design: the instruction is rasterized to an image and stamped in the page margin. No text object exists at all — nothing text-based can extract it. Tests whether a provider's ingestion has a vision path.",
  freetext_annot:
    "Round-3 diagnostic probe: invisible (PDF Tr 3) text inside a FreeText annotation's appearance stream. Not seen by this app's PDF.js-based extractor, but is extracted by poppler pdftotext.",
  acroform_field:
    "Round-3 diagnostic probe: the same invisible-text technique inside an AcroForm text-field widget's appearance. Not seen by this app's PDF.js-based extractor, but is extracted by poppler pdftotext.",
  info_dict:
    "Round-3 diagnostic probe: payload placed in the PDF /Info dictionary's Subject and Keywords fields, not in any page's text. Surfaced only by metadata reads (e.g. pdfinfo); the document's original Title is preserved.",
};

export function InjectionSettingsForm({
  settings,
  onChange,
  pageCount,
  instruction,
  koPayloadAvailable,
  canvasAvailable,
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
            {/*
              Ordering reflects the 2026-08-23 round-3 benchmark against gpt-5.6-luna:
              the three invisible channels that reached the model 5/5 are grouped first
              (white_text, render_mode_3, acroform_field), then the visible control, then
              the channels that did not reach the model in that run. This is a
              single-provider empirical ordering, not a universal ranking — see
              research/results/2026-08-23-round3-probe-modes/.
            */}
            <SelectItem value="white_text">White text (default)</SelectItem>
            <SelectItem value="render_mode_3">Render mode 3 (non-rendering)</SelectItem>
            <SelectItem value="acroform_field" data-testid="injection-mode-option-acroform-field">
              AcroForm field
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
              Unicode tags (research) {koPayloadAvailable ? "" : "(unavailable on this server)"}
            </SelectItem>
            <SelectItem
              value="image_only"
              disabled={!canvasAvailable}
              data-testid="injection-mode-option-image-only"
            >
              Image only (visible) {canvasAvailable ? "" : "(unavailable on this server)"}
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
              Research/diagnostic probe — not a production channel
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
              Round-3 research probe, visible by design: the instruction is rasterized to a PNG and
              stamped as a grey mark in the page margin — a human reader will see it, the same as
              Visible positive control. This is not a hiding technique; it exists to test whether a
              provider's ingestion has a vision path. No text object is written at all, so this
              app's Extracted Text tab will always be empty for this mode — that's expected, not a
              bug.
              {!canvasAvailable &&
                " Image only is currently unavailable on this server (the native canvas dependency is missing)."}
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "freetext_annot" && (
          <Alert variant="warning" data-testid="injection-mode-freetext-annot-caveat">
            <AlertDescription>
              Round-3 research probe: invisible (PDF Tr 3) text inside a FreeText annotation's
              appearance stream — not a production channel. This app's PDF.js-based Extracted Text
              tab will not show the payload (that's expected, not a bug); poppler's pdftotext does
              extract it, which is what this mode measures.
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "acroform_field" && (
          <Alert variant="warning" data-testid="injection-mode-acroform-field-caveat">
            <AlertDescription>
              Round-3 research probe: the same invisible-text technique as FreeText annotation,
              inside an AcroForm text-field widget's appearance — not a production channel. This
              app's PDF.js-based Extracted Text tab will not show the payload (that's expected, not
              a bug); poppler's pdftotext does extract it, which is what this mode measures.
            </AlertDescription>
          </Alert>
        )}
        {settings.mode === "info_dict" && (
          <Alert variant="warning" data-testid="injection-mode-info-dict-caveat">
            <AlertDescription>
              Round-3 research probe: the payload lives only in the PDF /Info dictionary's Subject
              and Keywords fields — not a production channel. It is never part of any page's text,
              so no text extractor (including this app's Extracted Text tab) will show it; it is
              surfaced only by metadata reads such as pdfinfo. The document's original Title is
              preserved.
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
