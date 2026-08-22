export interface EvidenceSpan {
  start: number;
  end: number;
}

interface RawSpanLike {
  start?: unknown;
  end?: unknown;
  index?: unknown;
  length?: unknown;
}

function normalizeSpan(candidate: unknown, textLength: number): EvidenceSpan | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = candidate as RawSpanLike;

  let start: number | null = null;
  let end: number | null = null;
  if (typeof raw.start === "number" && typeof raw.end === "number") {
    start = raw.start;
    end = raw.end;
  } else if (typeof raw.index === "number" && typeof raw.length === "number") {
    start = raw.index;
    end = raw.index + raw.length;
  }
  if (
    start === null ||
    end === null ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  ) {
    return null;
  }

  const clampedStart = Math.max(0, Math.min(start, textLength));
  const clampedEnd = Math.max(clampedStart, Math.min(end, textLength));
  return clampedEnd > clampedStart ? { start: clampedStart, end: clampedEnd } : null;
}

/**
 * Extracts zero or more `{start, end}` spans from a signal match's opaque
 * `evidence` value (`ExpectedSignal` matching is a `packages/detector`
 * implementation detail; the contract types it as `unknown`). Recognizes a
 * single object, or an array of objects, each shaped as either
 * `{start, end}` or `{index, length}`. Anything else (including a match with
 * no position info, e.g. an ordered_terms/section_order signal) yields no
 * spans — evidence highlighting degrades gracefully rather than guessing.
 */
export function extractEvidenceSpans(evidence: unknown, textLength: number): EvidenceSpan[] {
  if (Array.isArray(evidence)) {
    return evidence
      .map((item) => normalizeSpan(item, textLength))
      .filter((span): span is EvidenceSpan => span !== null);
  }
  const single = normalizeSpan(evidence, textLength);
  return single ? [single] : [];
}

/** Merges overlapping/adjacent spans and sorts them left-to-right. */
export function mergeSpans(spans: EvidenceSpan[]): EvidenceSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: EvidenceSpan[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export interface TextSegment {
  text: string;
  highlighted: boolean;
}

/** Splits `text` into highlighted/plain segments given matched evidence spans. */
export function computeHighlightSegments(text: string, spans: EvidenceSpan[]): TextSegment[] {
  const merged = mergeSpans(
    spans.filter((span) => span.start < text.length && span.end <= text.length),
  );
  if (merged.length === 0) return [{ text, highlighted: false }];

  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor)
      segments.push({ text: text.slice(cursor, span.start), highlighted: false });
    segments.push({ text: text.slice(span.start, span.end), highlighted: true });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
