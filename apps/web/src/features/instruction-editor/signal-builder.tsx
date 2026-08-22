import type { ExpectedSignal } from "@pdf-injection/contracts";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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

export interface SignalBuilderProps {
  signals: ExpectedSignal[];
  onChange: (signals: ExpectedSignal[]) => void;
}

type SignalType = ExpectedSignal["type"];

const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  exact_phrase: "Exact phrase",
  regex: "Regex",
  methodology_label: "Methodology label",
  ordered_terms: "Ordered terms",
  section_order: "Section order",
};

function defaultSignalFor(type: SignalType): ExpectedSignal {
  switch (type) {
    case "exact_phrase":
      return { type, value: "", caseSensitive: false };
    case "regex":
      return { type, pattern: "", flags: "i" };
    case "methodology_label":
      return { type, value: "", aliases: [] };
    case "ordered_terms":
      return { type, values: [] };
    case "section_order":
      return { type, values: [] };
  }
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function SignalBuilder({ signals, onChange }: SignalBuilderProps) {
  const [newType, setNewType] = useState<SignalType>("exact_phrase");

  function addSignal() {
    onChange([...signals, defaultSignalFor(newType)]);
  }

  function removeSignal(index: number) {
    onChange(signals.filter((_, i) => i !== index));
  }

  function updateSignal(index: number, next: ExpectedSignal) {
    onChange(signals.map((signal, i) => (i === index ? next : signal)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select value={newType} onValueChange={(value) => setNewType(value as SignalType)}>
          <SelectTrigger className="w-56" data-testid="signal-type-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SIGNAL_TYPE_LABELS) as SignalType[]).map((type) => (
              <SelectItem key={type} value={type}>
                {SIGNAL_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSignal}
          data-testid="signal-add-button"
        >
          <Plus /> Add expected signal
        </Button>
      </div>

      {signals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          At least one expected signal is required (e.g. a methodology label or ordered terms).
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {signals.map((signal, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: signals have no stable id and are reordered only by add/remove
            key={index}
            className="rounded-md border border-border p-3"
            data-testid={`signal-row-${index}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {SIGNAL_TYPE_LABELS[signal.type]}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                aria-label={`Remove signal ${index + 1}`}
                onClick={() => removeSignal(index)}
                data-testid={`signal-remove-${index}`}
              >
                <Trash2 className="size-4" />
                <span className="hidden md:inline">Remove</span>
              </Button>
            </div>

            {signal.type === "exact_phrase" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signal-${index}-value`}>Phrase</Label>
                <Input
                  id={`signal-${index}-value`}
                  value={signal.value}
                  onChange={(event) =>
                    updateSignal(index, { ...signal, value: event.target.value })
                  }
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`signal-${index}-case-sensitive`}
                    checked={signal.caseSensitive}
                    onCheckedChange={(checked) =>
                      updateSignal(index, { ...signal, caseSensitive: checked === true })
                    }
                  />
                  <Label htmlFor={`signal-${index}-case-sensitive`} className="font-normal">
                    Case sensitive
                  </Label>
                </div>
              </div>
            )}

            {signal.type === "regex" && (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor={`signal-${index}-pattern`}>Pattern</Label>
                  <Input
                    id={`signal-${index}-pattern`}
                    value={signal.pattern}
                    onChange={(event) =>
                      updateSignal(index, { ...signal, pattern: event.target.value })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`signal-${index}-flags`}>Flags</Label>
                  <Input
                    id={`signal-${index}-flags`}
                    value={signal.flags}
                    onChange={(event) =>
                      updateSignal(index, { ...signal, flags: event.target.value })
                    }
                  />
                </div>
              </div>
            )}

            {signal.type === "methodology_label" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signal-${index}-value`}>Value</Label>
                <Input
                  id={`signal-${index}-value`}
                  value={signal.value}
                  onChange={(event) =>
                    updateSignal(index, { ...signal, value: event.target.value })
                  }
                />
                <Label htmlFor={`signal-${index}-aliases`}>Aliases (comma-separated)</Label>
                <Input
                  id={`signal-${index}-aliases`}
                  value={signal.aliases.join(", ")}
                  onChange={(event) =>
                    updateSignal(index, { ...signal, aliases: splitList(event.target.value) })
                  }
                />
              </div>
            )}

            {(signal.type === "ordered_terms" || signal.type === "section_order") && (
              <div className="flex flex-col gap-2">
                <Label htmlFor={`signal-${index}-values`}>Values, in order (comma-separated)</Label>
                <Input
                  id={`signal-${index}-values`}
                  value={signal.values.join(", ")}
                  onChange={(event) =>
                    updateSignal(index, { ...signal, values: splitList(event.target.value) })
                  }
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
