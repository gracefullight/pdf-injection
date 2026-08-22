import type { ModelTestResult, ModelTestRun } from "@pdf-injection/contracts";

/** `GET …/model-tests/:runId/export?format=json` (contract §2) — the full `ModelTestRun`, pretty-printed. */
export function toJson(run: ModelTestRun): string {
  return JSON.stringify(run, null, 2);
}

export interface ToCsvOptions {
  /** Include the (potentially large, and potentially privacy-sensitive) `rawResponse` column. Defaults to `false` per contract §2 ("rawResponse excluded unless &includeRaw=true"). */
  includeRaw?: boolean;
}

const CSV_HEADERS = [
  "provider",
  "modelId",
  "condition",
  "repeat",
  "executedAt",
  "outerPromptSha256",
  "pdfSha256",
  "responseSha256",
  "allSignalsMatched",
  "anySignalMatched",
  "disclosure",
  "refusal",
  "latencyMs",
  "inputTokens",
  "outputTokens",
  "matchedSignalCount",
  "totalSignalCount",
  "error",
] as const;

/** RFC 4180 field quoting: wraps in `"..."` and doubles any embedded `"` whenever the field contains a comma, quote, or line break. */
function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function resultToRow(r: ModelTestResult, includeRaw: boolean): unknown[] {
  const row: unknown[] = [
    r.provider,
    r.modelId,
    r.condition,
    r.repeat,
    r.executedAt,
    r.outerPromptSha256,
    r.pdfSha256,
    r.responseSha256,
    r.allSignalsMatched,
    r.anySignalMatched,
    r.disclosure,
    r.refusal,
    r.latencyMs,
    r.usage.inputTokens,
    r.usage.outputTokens,
    r.signalMatches.filter((s) => s.matched).length,
    r.signalMatches.length,
    r.error ?? "",
  ];
  if (includeRaw) row.push(r.rawResponse);
  return row;
}

/**
 * `GET …/model-tests/:runId/export?format=csv` (contract §2) — one row per
 * `ModelTestResult`. RFC 4180 quoting; CRLF line endings.
 */
export function toCsv(run: ModelTestRun, options: ToCsvOptions = {}): string {
  const includeRaw = options.includeRaw ?? false;
  const headers: string[] = includeRaw ? [...CSV_HEADERS, "rawResponse"] : [...CSV_HEADERS];

  const lines = [headers.map(csvEscape).join(",")];
  for (const r of run.results) {
    lines.push(resultToRow(r, includeRaw).map(csvEscape).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
