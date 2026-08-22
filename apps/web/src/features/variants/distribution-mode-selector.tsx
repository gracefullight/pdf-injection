import type { KeyboardEvent } from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import type { DistributionMode } from "@/features/variants/variant-types";

export interface DistributionModeSelectorProps {
  mode: DistributionMode;
  onChange: (mode: DistributionMode) => void;
}

const MODES: Array<{ value: DistributionMode; label: string; description: string }> = [
  { value: "single", label: "Single", description: "One instruction, one output PDF (default)." },
  {
    value: "variants",
    label: "Variants (A/B/C…)",
    description: "2-8 labeled variants from the same source PDF, for group comparison.",
  },
  {
    value: "student_keyed",
    label: "Student-keyed",
    description:
      "One output per student, each with a unique embedded key substituted into the instruction.",
  },
];

/** Distribution mode selector on the Instruction screen — gates which editor renders below it. */
export function DistributionModeSelector({ mode, onChange }: DistributionModeSelectorProps) {
  const active = MODES.find((option) => option.value === mode);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Arrow-key roving tabindex for the button-based radiogroup (r11 DX review L3, carried
  // forward from r7's QA review): each option was already independently Tab-focusable, but a
  // native ARIA radiogroup's Left/Right/Up/Down arrow-key navigation (WAI-ARIA APG "Radio
  // Group" pattern) wasn't wired up — only one option is a Tab stop at a time, and Left/Right
  // moves selection between options, matching what a screen-reader user expects from `role="radio"`.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      nextIndex = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      nextIndex = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = MODES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextOption = MODES[nextIndex];
    if (!nextOption) return;
    onChange(nextOption.value);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="distribution-mode-selector">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Distribution mode">
        {MODES.map((option, index) => (
          <Button
            key={option.value}
            ref={(element) => {
              buttonRefs.current[index] = element;
            }}
            type="button"
            variant={mode === option.value ? "default" : "outline"}
            size="sm"
            role="radio"
            aria-checked={mode === option.value}
            tabIndex={mode === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            data-testid={`distribution-mode-${option.value}`}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{active?.description}</p>
    </div>
  );
}
