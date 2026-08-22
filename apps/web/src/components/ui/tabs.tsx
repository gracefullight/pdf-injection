import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Bug fix (r9): a fixed `h-10` combined with `flex-wrap` clips/overlaps any wrapped second
      // row once enough triggers are present to wrap (validation-screen.tsx grew to 8 tabs this
      // round) — the wrapped row renders outside the fixed-height box, underneath the
      // `TabsContent` positioned right after it in normal flow, so its triggers become
      // unclickable (pointer events land on TabsContent instead). `min-h-10` reserves the
      // single-row minimum without capping height when wrapping occurs.
      //
      // `text-slate-600` (not the semantic `text-muted-foreground` / #64748b) for inactive
      // triggers: #64748b on this list's #f1f5f9 background measures 4.34:1, just under WCAG AA's
      // 4.5:1 text-contrast minimum; #475569 measures 6.6:1 (r11 review, H-02 contrast note).
      "inline-flex min-h-10 flex-wrap items-center justify-start gap-1 rounded-md bg-secondary p-1 text-slate-600",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // `min-h-11` (44px, WCAG 2.5.8 target size) below `md`; the tighter `py-1.5` (~32px) is
      // fine once a mouse is the primary pointer (r11 review M-20).
      "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm md:min-h-0",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
