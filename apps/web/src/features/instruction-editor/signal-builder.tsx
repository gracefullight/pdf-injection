import type { ExpectedSignal } from "@pdf-injection/contracts";
import { signalHasEmptyValue } from "@pdf-injection/prompt-lint";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";

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

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

interface CommaListInputProps {
  id: string;
  values: string[];
  onValuesChange: (values: string[]) => void;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Comma-separated list input that keeps the raw text the user is typing.
 * Normalizing `values.join(", ")` back into the field on every keystroke made
 * it impossible to type a comma or a space (the trailing separator was trimmed
 * away immediately); the parsed list is only derived from the raw text.
 */
function CommaListInput({ id, values, onValuesChange, invalid, describedBy }: CommaListInputProps) {
  const [raw, setRaw] = useState(() => values.join(", "));
  const rawRef = useRef(raw);
  rawRef.current = raw;
  // Re-sync only when the list changed externally (e.g. draft restore, signal swap);
  // the ref keeps `raw` out of the dependency list so typing is never undone.
  useEffect(() => {
    if (splitList(rawRef.current).join("\u0000") !== values.join("\u0000")) {
      setRaw(values.join(", "));
    }
  }, [values]);
  return (
    <Input
      id={id}
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        onValuesChange(splitList(event.target.value));
      }}
      onBlur={() => setRaw(splitList(raw).join(", "))}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
    />
  );
}

function emptySignalMessage(signal: ExpectedSignal): string {
  switch (signal.type) {
    case "exact_phrase":
      return "Enter a phrase or remove this signal.";
    case "regex":
      return "Enter a pattern or remove this signal.";
    case "methodology_label":
      return "Enter a methodology label or remove this signal.";
    case "ordered_terms":
    case "section_order":
      return "Enter at least one value or remove this signal.";
  }
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
        <p className="text-sm text-muted-foreground" data-testid="signal-builder-empty-hint">
          No signals yet. Add at least one if you plan to run Model Test, Submissions or Robustness
          scoring on this PDF.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {signals.map((signal, index) => {
          const invalid = signalHasEmptyValue(signal);
          const errorId = `signal-row-error-${index}`;
          const describedBy = invalid ? errorId : undefined;

          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: signals have no stable id and are reordered only by add/remove
              key={index}
              className={cn(
                "rounded-md border border-border p-3",
                invalid && "border-destructive/50",
              )}
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
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
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
                      aria-invalid={invalid || undefined}
                      aria-describedby={describedBy}
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
                    aria-invalid={invalid || undefined}
                    aria-describedby={describedBy}
                    onChange={(event) =>
                      updateSignal(index, { ...signal, value: event.target.value })
                    }
                  />
                  <Label htmlFor={`signal-${index}-aliases`}>Aliases (comma-separated)</Label>
                  <CommaListInput
                    id={`signal-${index}-aliases`}
                    values={signal.aliases}
                    onValuesChange={(aliases) => updateSignal(index, { ...signal, aliases })}
                  />
                </div>
              )}

              {(signal.type === "ordered_terms" || signal.type === "section_order") && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`signal-${index}-values`}>
                    Values, in order (comma-separated)
                  </Label>
                  <CommaListInput
                    id={`signal-${index}-values`}
                    values={signal.values}
                    onValuesChange={(values) => updateSignal(index, { ...signal, values })}
                    invalid={invalid}
                    describedBy={describedBy}
                  />
                </div>
              )}

              {invalid && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-2 text-sm text-destructive"
                  data-testid={errorId}
                >
                  {emptySignalMessage(signal)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
