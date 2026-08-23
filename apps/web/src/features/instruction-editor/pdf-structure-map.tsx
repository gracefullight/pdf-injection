import type { InjectionMode } from "@pdf-injection/contracts";
import { Fragment, type ReactNode } from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ANATOMY_MAP,
  ANATOMY_PROVENANCE,
  ANATOMY_REGION_LABELS,
  type AnatomyRegion,
  type AnatomySiteId,
  type DetectorVerdict,
  type ExtractorLevel,
  INJECTION_ANATOMY,
  REACHED_SITE_IDS,
  type ReachVerdict,
} from "@/lib/injection-anatomy";
import { cn } from "@/lib/utils";

export interface PdfStructureMapProps {
  /** The currently selected injection mode — the map highlights this mode's structural site(s). */
  mode: InjectionMode;
  className?: string;
}

const REGION_ORDER: readonly AnatomyRegion[] = ["header", "body", "xref", "trailer"];

const REACH_BADGE_VARIANT: Record<ReachVerdict, BadgeProps["variant"]> = {
  reached: "success",
  not_reached: "secondary",
};

const EXTRACTOR_BADGE_VARIANT: Record<ExtractorLevel, BadgeProps["variant"]> = {
  good: "success",
  warn: "warning",
  blocked: "secondary",
};

const DETECTOR_BADGE_VARIANT: Record<DetectorVerdict, BadgeProps["variant"]> = {
  clean: "success",
  warn: "warning",
  crit: "destructive",
};

const REACH_LABEL: Record<ReachVerdict, string> = {
  reached: "reached",
  not_reached: "blocked",
};

const EXTRACTOR_LABEL: Record<ExtractorLevel, string> = {
  good: "seen",
  warn: "partial",
  blocked: "unseen",
};

const DETECTOR_LABEL: Record<DetectorVerdict, string> = {
  clean: "clean",
  warn: "partial",
  crit: "flagged",
};

/**
 * Turns `**word**` markers (this module's plain-text emphasis convention) into `<strong>`. Keys
 * are the part's starting character offset in `text` — stable and unique, not an array index.
 */
function renderEmphasis(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
    const key = offset;
    offset += part.length;
    if (part.length === 0) continue;
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else {
      nodes.push(<Fragment key={key}>{part}</Fragment>);
    }
  }
  return nodes;
}

interface VerdictCellProps {
  label: string;
  /** Short, factual explanation of what this cell measures — shown in a focusable tooltip. */
  explanation: string;
  variant: BadgeProps["variant"];
  badgeText: string;
  detail: string;
  testId: string;
}

function VerdictCell({ label, explanation, variant, badgeText, detail, testId }: VerdictCellProps) {
  return (
    <div
      className="min-w-[130px] flex-1 rounded-md border border-border bg-secondary/50 p-2"
      data-testid={testId}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-sm font-mono text-[10px] uppercase tracking-wide text-muted-foreground underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={`${testId}-label`}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-64">{explanation}</p>
        </TooltipContent>
      </Tooltip>
      <div className="mt-1 flex items-center gap-1.5">
        <Badge variant={variant} className="font-mono text-[11px]">
          {badgeText}
        </Badge>
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={detail}>
        {detail}
      </p>
    </div>
  );
}

/**
 * Visualizes where in the PDF's structure the selected injection mode writes its payload, and
 * shows this app's measured research verdict for that mode (reach / extractor / detector).
 * Structural location is a stable PDF fact; reach/extractor/detector verdicts are one provider's
 * measured results and always carry `ANATOMY_PROVENANCE`.
 */
export function PdfStructureMap({ mode, className }: PdfStructureMapProps) {
  const anatomy = INJECTION_ANATOMY[mode];
  const activeSiteIds = new Set<AnatomySiteId>(anatomy.siteIds);

  const rowsByRegion = REGION_ORDER.map((region) => ({
    region,
    rows: ANATOMY_MAP.filter((row) => row.region === region),
  }));

  return (
    <div className={cn("grid gap-3 md:grid-cols-2", className)} data-testid="pdf-structure-map">
      <Card>
        <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            PDF structure
          </CardTitle>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            green dot = reaches model
          </span>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pt-0 font-mono text-xs">
          {rowsByRegion.map(({ region, rows }) => (
            <div key={region} className="overflow-hidden rounded-md border border-border">
              <div className="border-b border-border bg-secondary/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {ANATOMY_REGION_LABELS[region]}
              </div>
              <div className="flex flex-col gap-0.5 p-1.5">
                {rows.map((row) => {
                  if (row.kind === "context") {
                    return (
                      <div
                        key={row.text}
                        style={{ paddingLeft: 10 + row.depth * 16 }}
                        className="truncate px-2 py-1 text-muted-foreground"
                      >
                        {row.text}
                      </div>
                    );
                  }

                  const isActive = activeSiteIds.has(row.id);
                  // The active row's dot must agree with this mode's own verdict panel:
                  // a shared site (e.g. `content`) reaches for white_text but not for
                  // unicode_tags, so keying the active dot off the site-level union would
                  // contradict the "blocked" badge. Non-active rows keep the site-level
                  // "any technique reaches here" advance hint.
                  const reaches = isActive
                    ? anatomy.reach.verdict === "reached"
                    : REACHED_SITE_IDS.has(row.id);

                  return (
                    <div
                      key={row.id}
                      data-testid={`pdf-structure-map-site-${row.id}`}
                      data-active={isActive}
                      aria-current={isActive ? "true" : undefined}
                      style={{ paddingLeft: 10 + row.depth * 16 }}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1 transition-colors motion-reduce:transition-none",
                        isActive
                          ? "bg-accent text-accent-foreground ring-1 ring-inset ring-accent-foreground/40"
                          : "text-foreground/60 opacity-60",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "h-2 w-2 flex-none rounded-full",
                          reaches ? "bg-success-foreground" : "bg-muted-foreground",
                        )}
                      />
                      <span className="truncate">{row.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-2">
          <p className="font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
            {anatomy.visible ? "Visible channel" : "Hidden channel"}
          </p>
          <CardTitle className="text-lg">{anatomy.displayName}</CardTitle>
          <code
            data-testid="pdf-structure-map-location"
            className="mt-1 block w-fit break-all rounded-md border border-accent-foreground/30 bg-accent px-2.5 py-1.5 font-mono text-[11.5px] text-accent-foreground"
          >
            {anatomy.location}
          </code>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <TooltipProvider>
            <div className="flex flex-wrap gap-2">
              <VerdictCell
                label="Reaches model"
                explanation="Whether the payload appeared in the model's response in the 2026-08-23 gpt-5.6-luna benchmark. Evidence of ingestion, not proof the model obeyed."
                variant={REACH_BADGE_VARIANT[anatomy.reach.verdict]}
                badgeText={`${REACH_LABEL[anatomy.reach.verdict]} · ${anatomy.reach.delta}`}
                detail={anatomy.reach.verdict}
                testId="pdf-structure-map-reach"
              />
              <VerdictCell
                label="Extractors"
                explanation="Whether common PDF text extractors (pdftotext, PyMuPDF, pypdf, PDF.js) surface the payload from the file."
                variant={EXTRACTOR_BADGE_VARIANT[anatomy.extractors.level]}
                badgeText={EXTRACTOR_LABEL[anatomy.extractors.level]}
                detail={anatomy.extractors.summary}
                testId="pdf-structure-map-extractors"
              />
              <VerdictCell
                label="Hidden-text scanner"
                explanation="Whether an open-source hidden-text detector (wppoland/hidden-text-detector) flags this technique. 'flagged' means a covert canary here is discoverable by anyone running such a scan."
                variant={DETECTOR_BADGE_VARIANT[anatomy.detector.verdict]}
                badgeText={DETECTOR_LABEL[anatomy.detector.verdict]}
                detail={anatomy.detector.summary}
                testId="pdf-structure-map-detector"
              />
            </div>
          </TooltipProvider>
          <p className="text-sm text-muted-foreground">{renderEmphasis(anatomy.body)}</p>
          <p
            data-testid="pdf-structure-map-provenance"
            className="font-mono text-[10.5px] text-muted-foreground"
          >
            {ANATOMY_PROVENANCE}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
