import { describe, expect, it } from "bun:test";
import {
  computeHighlightSegments,
  extractEvidenceSpans,
  mergeSpans,
} from "@/features/submissions/highlight-spans";

describe("extractEvidenceSpans", () => {
  it("extracts a single {start, end} object", () => {
    expect(extractEvidenceSpans({ start: 2, end: 5 }, 20)).toEqual([{ start: 2, end: 5 }]);
  });

  it("extracts a single {index, length} object", () => {
    expect(extractEvidenceSpans({ index: 3, length: 4 }, 20)).toEqual([{ start: 3, end: 7 }]);
  });

  it("extracts an array of spans", () => {
    expect(
      extractEvidenceSpans(
        [
          { start: 0, end: 2 },
          { index: 5, length: 3 },
        ],
        20,
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 8 },
    ]);
  });

  it("returns an empty array for evidence with no recognizable position", () => {
    expect(extractEvidenceSpans({ matchedOrder: ["a", "b"] }, 20)).toEqual([]);
    expect(extractEvidenceSpans(null, 20)).toEqual([]);
    expect(extractEvidenceSpans(undefined, 20)).toEqual([]);
    expect(extractEvidenceSpans("plain string evidence", 20)).toEqual([]);
  });

  it("clamps spans to text length and drops degenerate ranges", () => {
    expect(extractEvidenceSpans({ start: 10, end: 30 }, 15)).toEqual([{ start: 10, end: 15 }]);
    expect(extractEvidenceSpans({ start: 5, end: 5 }, 20)).toEqual([]);
    expect(extractEvidenceSpans({ start: -5, end: 3 }, 20)).toEqual([{ start: 0, end: 3 }]);
  });
});

describe("mergeSpans", () => {
  it("merges overlapping and adjacent spans", () => {
    expect(
      mergeSpans([
        { start: 0, end: 5 },
        { start: 3, end: 8 },
        { start: 10, end: 12 },
      ]),
    ).toEqual([
      { start: 0, end: 8 },
      { start: 10, end: 12 },
    ]);
  });

  it("sorts unsorted input", () => {
    expect(
      mergeSpans([
        { start: 10, end: 12 },
        { start: 0, end: 2 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 10, end: 12 },
    ]);
  });
});

describe("computeHighlightSegments", () => {
  it("returns the whole text as one plain segment when there are no spans", () => {
    expect(computeHighlightSegments("hello world", [])).toEqual([
      { text: "hello world", highlighted: false },
    ]);
  });

  it("splits text around a single span", () => {
    const segments = computeHighlightSegments("hello world", [{ start: 6, end: 11 }]);
    expect(segments).toEqual([
      { text: "hello ", highlighted: false },
      { text: "world", highlighted: true },
    ]);
  });

  it("splits text around multiple non-overlapping spans", () => {
    const segments = computeHighlightSegments("abcdefghij", [
      { start: 2, end: 4 },
      { start: 7, end: 9 },
    ]);
    expect(segments).toEqual([
      { text: "ab", highlighted: false },
      { text: "cd", highlighted: true },
      { text: "efg", highlighted: false },
      { text: "hi", highlighted: true },
      { text: "j", highlighted: false },
    ]);
  });

  it("ignores spans that fall outside the text bounds", () => {
    const segments = computeHighlightSegments("short", [{ start: 10, end: 15 }]);
    expect(segments).toEqual([{ text: "short", highlighted: false }]);
  });
});
