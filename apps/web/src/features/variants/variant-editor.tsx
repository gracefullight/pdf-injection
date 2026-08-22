import type { PayloadLanguage } from "@pdf-injection/contracts";
import { lintPrompt } from "@pdf-injection/prompt-lint";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LintPanel } from "@/features/instruction-editor/lint-panel";
import { SignalBuilder } from "@/features/instruction-editor/signal-builder";
import { updateVariantDraft } from "@/features/variants/variant-draft-update";
import {
  MAX_VARIANTS,
  MIN_VARIANTS,
  nextVariantLabel,
  type VariantDraft,
} from "@/features/variants/variant-types";

export interface VariantEditorProps {
  variants: VariantDraft[];
  onChange: (variants: VariantDraft[]) => void;
  /**
   * Threaded into `lintPrompt` for every card — otherwise a Korean variant
   * instruction is always flagged `encoding_unsupported` even after "ko" is
   * selected in `InjectionSettingsForm` (cycle 3, same bug class r9 fixed
   * for `instruction-screen.tsx`'s single-mode `lintPrompt` call).
   */
  payloadLanguage: PayloadLanguage;
  /** Wired to the shared `settings.payloadLanguage` setter — see `LintPanel`'s doc comment (r11 M-21). */
  onSwitchToKorean?: () => void;
}

/** A/B/C… variant editor: add/remove cards (min 2, max 8), each with its own instruction, lint panel, and expected signals. */
export function VariantEditor({
  variants,
  onChange,
  payloadLanguage,
  onSwitchToKorean,
}: VariantEditorProps) {
  const labels = variants.map((variant) => variant.label);
  const duplicateLabels = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));

  // Clears a variant's own acknowledgedWarnings whenever its instruction or
  // signals change — see variant-draft-update.ts (QA result-qa-r7 MEDIUM 2).
  function updateVariant(index: number, patch: Partial<VariantDraft>) {
    onChange(
      variants.map((variant, i) => (i === index ? updateVariantDraft(variant, patch) : variant)),
    );
  }

  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return;
    onChange([
      ...variants,
      { label: nextVariantLabel(variants), instruction: "", signals: [], acknowledgedWarnings: [] },
    ]);
  }

  function removeVariant(index: number) {
    if (variants.length <= MIN_VARIANTS) return;
    onChange(variants.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-4" data-testid="variant-editor">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {variants.length} of {MAX_VARIANTS} variants (minimum {MIN_VARIANTS})
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addVariant}
          disabled={variants.length >= MAX_VARIANTS}
          data-testid="variant-add-button"
        >
          <Plus /> Add variant
        </Button>
      </div>

      <ul className="flex flex-col gap-4">
        {variants.map((variant, index) => {
          const lint = lintPrompt(variant.instruction, variant.signals, { payloadLanguage });
          const isDuplicateLabel = duplicateLabels.has(variant.label);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: variants have no stable id and are reordered only by add/remove
              key={index}
              className="rounded-md border border-border p-4"
              data-testid={`variant-card-${index}`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={`variant-${index}-label`}>Label</Label>
                  <Input
                    id={`variant-${index}-label`}
                    value={variant.label}
                    onChange={(event) => updateVariant(index, { label: event.target.value })}
                    className="w-32"
                    aria-invalid={isDuplicateLabel}
                    data-testid={`variant-${index}-label-input`}
                  />
                  {isDuplicateLabel && (
                    <p className="text-xs text-destructive">Labels must be unique.</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  aria-label={`Remove variant ${variant.label}`}
                  onClick={() => removeVariant(index)}
                  disabled={variants.length <= MIN_VARIANTS}
                  data-testid={`variant-remove-${index}`}
                >
                  <Trash2 className="size-4" />
                  <span className="hidden md:inline">Remove</span>
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`variant-${index}-instruction`}>Instruction</Label>
                <Textarea
                  id={`variant-${index}-instruction`}
                  rows={5}
                  value={variant.instruction}
                  onChange={(event) => updateVariant(index, { instruction: event.target.value })}
                  data-testid={`variant-${index}-instruction-textarea`}
                />
              </div>

              <LintPanel
                errors={lint.errors}
                warnings={lint.warnings}
                acknowledged={variant.acknowledgedWarnings}
                onAcknowledgedChange={(acknowledged) =>
                  updateVariant(index, { acknowledgedWarnings: acknowledged })
                }
                onSwitchToKorean={onSwitchToKorean}
              />

              <div className="mt-3">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  Expected signals
                </span>
                <div className="mt-2">
                  <SignalBuilder
                    signals={variant.signals}
                    onChange={(signals) => updateVariant(index, { signals })}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
