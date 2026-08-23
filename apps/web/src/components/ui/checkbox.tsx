import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  // `size-6` (24px) on the actual interactive/clickable Root — WCAG 2.2 2.5.8 Target Size
  // (Minimum) requires >=24x24 CSS px; the visible glyph inside stays the same ~20px square via
  // the inner `size-5` span below, so the checkbox doesn't *look* any bigger, but its real
  // clickable + measurable (`getBoundingClientRect()`) box now meets the minimum (r11 review
  // M-20 cycle 3 residual — designer re-verification found the 20px box still under 24px at
  // 375px). Centralized here so every checkbox in the app gets the fix, not just
  // acknowledgement ones — WCAG 2.5.8 isn't scoped to any particular checkbox's purpose.
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // `peer` (unchanged) is for `Label`'s `peer-disabled:` styling (a *sibling* relationship);
      // `group` is new, for the inner glyph span below (a *child* of Root — `peer-*` only
      // matches siblings, so `data-[state=checked]` on Root needs `group`/`group-*` to reach it).
      "peer group flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {/* `size-5` (20px, up from `size-4`/16px) + `border-slate-500` (up from `border-input` /
     * #e2e8f0, which measured ~1.1:1 on the amber warning-alert background and ~1.3:1 on
     * white — far below WCAG 2.2 1.4.11's 3:1 non-text-contrast minimum for a control that
     * gates the main flow (acknowledge-warning checkbox)) — r11 review H-08. */}
    <span
      aria-hidden="true"
      className="flex size-5 items-center justify-center rounded-sm border border-slate-500 group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground"
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-4" />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
