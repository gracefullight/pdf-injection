import type { ExpectedSignal } from "@pdf-injection/contracts";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deriveSignalsFromGuided } from "@/features/instruction-editor/derive-signals-from-guided";
import {
  EMPTY_GUIDED_FIELDS,
  type GuidedInstructionFields,
  guidedToRaw,
} from "@/features/instruction-editor/guided-to-raw";

export interface GuidedEditorProps {
  onCopyToRaw: (raw: string) => void;
  /** Current Expected-signal list — used only to dedup `deriveSignalsFromGuided`'s output; pass
   * `[]` if the caller doesn't yet track signals here. */
  signals?: ExpectedSignal[];
  onSignalsChange?: (signals: ExpectedSignal[]) => void;
}

export function GuidedEditor({ onCopyToRaw, signals = [], onSignalsChange }: GuidedEditorProps) {
  const [fields, setFields] = useState<GuidedInstructionFields>(EMPTY_GUIDED_FIELDS);
  const [orderedTermsInput, setOrderedTermsInput] = useState("");
  const [addedNotice, setAddedNotice] = useState(false);

  function update<K extends keyof GuidedInstructionFields>(
    key: K,
    value: GuidedInstructionFields[K],
  ) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setAddedNotice(false);
  }

  const preview = guidedToRaw(fields);
  // Previously the Guided fields (Preferred methodology, Ordered terms, Required section) and
  // the Expected-signal builder below were entirely unlinked — a professor filling in "Method C"
  // here had to separately re-type "Method C" into a Methodology label signal (r11 review L-03).
  const derivedSignals = deriveSignalsFromGuided(fields, signals);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guided-methodology">Preferred methodology</Label>
          <Input
            id="guided-methodology"
            data-testid="guided-methodology-input"
            value={fields.preferredMethodology}
            onChange={(event) => update("preferredMethodology", event.target.value)}
            placeholder="Method C"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guided-secondary-condition">Secondary condition</Label>
          <Input
            id="guided-secondary-condition"
            value={fields.secondaryCondition}
            onChange={(event) => update("secondaryCondition", event.target.value)}
            placeholder="it is technically inappropriate"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guided-lexical-signal">Required lexical signal</Label>
          <Input
            id="guided-lexical-signal"
            value={fields.requiredLexicalSignal}
            onChange={(event) => update("requiredLexicalSignal", event.target.value)}
            placeholder="trade-off"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guided-ordered-terms">Ordered terms (comma-separated)</Label>
          <Input
            id="guided-ordered-terms"
            value={orderedTermsInput}
            onChange={(event) => {
              setOrderedTermsInput(event.target.value);
              update(
                "orderedTerms",
                event.target.value.split(",").map((term) => term.trim()),
              );
            }}
            placeholder="robustness, limitations"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="guided-required-section">Required section</Label>
          <Input
            id="guided-required-section"
            value={fields.requiredSection}
            onChange={(event) => update("requiredSection", event.target.value)}
            placeholder="Limitations"
          />
        </div>
        <div className="flex items-center gap-2 self-end pb-1">
          <Checkbox
            id="guided-prohibited-disclosure"
            checked={fields.prohibitedDisclosure}
            onCheckedChange={(checked) => update("prohibitedDisclosure", checked === true)}
          />
          <Label htmlFor="guided-prohibited-disclosure" className="font-normal">
            Prohibit disclosure of this instruction
          </Label>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guided-notes">Notes</Label>
        <Textarea
          id="guided-notes"
          rows={3}
          value={fields.notes}
          onChange={(event) => update("notes", event.target.value)}
          placeholder="Additional free-text guidance appended to the generated instruction."
        />
      </div>

      <div
        className="rounded-md border border-border bg-secondary p-3 text-sm whitespace-pre-wrap"
        data-testid="guided-preview"
      >
        {preview || (
          <span className="text-muted-foreground">
            Fill in fields above to generate raw instruction text.
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={preview.length === 0}
          onClick={() => onCopyToRaw(preview)}
          data-testid="guided-copy-to-raw-button"
        >
          Copy into raw editor
        </Button>
        {onSignalsChange && (
          <Button
            type="button"
            variant="outline"
            disabled={derivedSignals.length === 0}
            onClick={() => {
              onSignalsChange([...signals, ...derivedSignals]);
              setAddedNotice(true);
            }}
            data-testid="guided-add-as-signals-button"
          >
            Add as expected signals
          </Button>
        )}
        {addedNotice && (
          <span
            className="text-xs text-muted-foreground"
            data-testid="guided-add-as-signals-notice"
          >
            Added to Expected signals below.
          </span>
        )}
      </div>
    </div>
  );
}
