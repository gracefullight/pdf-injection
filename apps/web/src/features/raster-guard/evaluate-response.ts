import type { ExpectedSignal } from "@pdf-injection/contracts";
import { matchSignals } from "@pdf-injection/detector";

/**
 * Scores a live model response against the notice's canaries.
 *
 * `matchSignals()` from `packages/detector` is reused rather than
 * reimplemented, so a Raster Guard live check and a server-side submission
 * analysis agree on what "matched" means.
 *
 * The vocabulary here is deliberately about the *response*: a notice was
 * surfaced or it was not. Nothing in this module says anything about the person
 * who uploaded the document — the same rule the detector package states for
 * every one of its own exports.
 */

export type NoticeOutcome = "surfaced" | "partially_surfaced" | "not_surfaced";

export interface NoticeCheckResult {
  outcome: NoticeOutcome;
  matchedCount: number;
  total: number;
  /** Per-signal evidence, in the plan's own signal order. */
  matches: { label: string; matched: boolean }[];
  headline: string;
}

/** Short human label for a signal, for the results table. */
export function signalLabel(signal: ExpectedSignal): string {
  switch (signal.type) {
    case "exact_phrase":
      return `Exact phrase: "${truncate(signal.value, 60)}"`;
    case "ordered_terms":
      return `Terms in order: ${signal.values.join(" -> ")}`;
    case "regex":
      return `Pattern: /${truncate(signal.pattern, 40)}/${signal.flags}`;
    case "methodology_label":
      return `Methodology label: ${signal.value}`;
    case "section_order":
      return `Section order: ${signal.values.join(" -> ")}`;
  }
}

export function checkNoticeResponse(
  responseText: string,
  signals: ExpectedSignal[],
): NoticeCheckResult {
  if (signals.length === 0) {
    return {
      outcome: "not_surfaced",
      matchedCount: 0,
      total: 0,
      matches: [],
      headline:
        "No canary signals were defined for this notice, so there is nothing to check against.",
    };
  }

  const report = matchSignals(signals, responseText);
  const matches = report.results.map((entry) => ({
    label: signalLabel(entry.signal),
    matched: entry.matched,
  }));

  const outcome: NoticeOutcome =
    report.matchedCount === 0
      ? "not_surfaced"
      : report.matchedCount === report.total
        ? "surfaced"
        : "partially_surfaced";

  return {
    outcome,
    matchedCount: report.matchedCount,
    total: report.total,
    matches,
    headline: HEADLINES[outcome],
  };
}

/**
 * Fixed, non-overclaiming headlines, drawn from a closed set — the same
 * discipline `SubmissionAnalysis.interpretation` follows on the server.
 */
const HEADLINES: Record<NoticeOutcome, string> = {
  surfaced:
    "The assistant's reply carried every canary from the notice. The notice reached the model and shaped the response in this run.",
  partially_surfaced:
    "The assistant's reply carried some canaries but not all. The notice reached the model; how much of it was acted on is unclear from one run.",
  not_surfaced:
    "The assistant's reply carried no canary from the notice. This one run gives no evidence the notice reached the model, and is not evidence that it never will.",
};

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
