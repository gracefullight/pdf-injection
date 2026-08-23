import { cn } from "@/lib/utils";

export interface RequiredMarkProps {
  className?: string;
}

/**
 * Decorative red asterisk marking a required field/section. Purely visual — the real
 * "this is required" signal for assistive tech is `aria-required`/`required` on the
 * associated input, set alongside this mark at each call site.
 */
export function RequiredMark({ className }: RequiredMarkProps) {
  return (
    <span aria-hidden="true" className={cn("ml-0.5 text-destructive", className)}>
      *
    </span>
  );
}
