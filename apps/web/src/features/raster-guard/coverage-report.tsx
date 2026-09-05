import {
  type GuardPlan,
  getProviderProfile,
  type LegibilityVerdict,
  type ProviderCoverage,
} from "@pdf-injection/raster-guard";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const VERDICT_BADGE: Record<
  LegibilityVerdict,
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  reliable: { label: "Predicted readable", variant: "success" },
  marginal: { label: "Marginal", variant: "warning" },
  unreadable: { label: "Predicted unreadable", variant: "destructive" },
};

export function VerdictBadge({ verdict }: { verdict: LegibilityVerdict }) {
  const badge = VERDICT_BADGE[verdict];
  return (
    <Badge variant={badge.variant} data-testid={`verdict-${verdict}`}>
      {badge.label}
    </Badge>
  );
}

/**
 * The per-provider prediction, with the arithmetic behind it on show.
 *
 * Every number in this table is derived from published ingestion geometry, not
 * measured against a live model, and the table says so in its own footer rather
 * than in documentation the reader will not open. The live check below it is
 * what turns a prediction into an observation.
 */
export function CoverageReport({
  coverage,
  plan,
  backgroundHex,
}: {
  coverage: ProviderCoverage[];
  plan: GuardPlan;
  backgroundHex: string;
}) {
  const channelOf = new Map(plan.instances.map((instance) => [instance.id, instance]));

  return (
    <div className="flex flex-col gap-4" data-testid="raster-guard-coverage">
      <div className="grid gap-3 sm:grid-cols-3">
        {coverage.map((provider) => (
          <div key={provider.providerId} className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{provider.label}</p>
            <div className="mt-2">
              <VerdictBadge verdict={provider.verdict} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {provider.bestInstanceId
                ? `Carried by the ${(channelOf.get(provider.bestInstanceId)?.channel ?? "").replace(/_/g, " ")} rung.`
                : "No rung landed on a page this report could measure."}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rung</TableHead>
              <TableHead>Assistant</TableHead>
              <TableHead className="text-right">Cap height</TableHead>
              <TableHead className="text-right">Contrast</TableHead>
              <TableHead>Prediction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {coverage.flatMap((provider) =>
              provider.perInstance
                .filter((entry) => (channelOf.get(entry.instanceId)?.pageIndex ?? 0) === 0)
                .map((entry) => {
                  const instance = channelOf.get(entry.instanceId);
                  return (
                    <TableRow key={`${provider.providerId}-${entry.instanceId}`}>
                      <TableCell className="whitespace-nowrap">
                        {(instance?.channel ?? entry.instanceId).replace(/_/g, " ")}
                        <span className="block text-xs text-muted-foreground">
                          {instance ? `${instance.fontSizePt.toFixed(1)}pt` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{provider.label}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.capHeightPx.toFixed(1)} px
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.contrastRatio.toFixed(2)}:1
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={entry.verdict} />
                        {entry.reasons.length > 0 && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {entry.reasons[0]}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }),
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          Cap height is what each glyph measures after that assistant's documented resizing.
          Contrast is the WCAG ratio of the painted ink against the paper colour sampled under the
          notice ({backgroundHex}). Both are predictions from published ingestion geometry, not
          measurements against a live model — run the live check to observe the real behaviour.
        </p>
        <p>
          One limit applies to all three: vendors rasterize PDF pages on their own servers at
          resolutions they do not publish. The raster resolution chosen above is an upper bound on
          the detail that reaches the model, never a guarantee of it.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {coverage.map((provider) => (
            <li key={`${provider.providerId}-uncertainty`}>
              <span className="font-medium text-foreground">{provider.label}:</span>{" "}
              {getProviderProfile(provider.providerId).uncertaintyNote}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
