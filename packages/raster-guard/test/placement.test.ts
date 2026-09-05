import { describe, expect, it } from "bun:test";
import {
  blockRectInBand,
  claimBandSpan,
  edgeStripRect,
  findFreeBands,
  occupiedBoxesFromTextItems,
  pickBand,
} from "../src/placement";
import type { PageLayout } from "../src/types";

function page(occupied: PageLayout["occupied"]): PageLayout {
  return { pageIndex: 0, widthPt: 612, heightPt: 792, occupied };
}

describe("findFreeBands", () => {
  it("returns the whole page when nothing occupies it", () => {
    const bands = findFreeBands(page([]));
    expect(bands).toHaveLength(1);
    expect(bands[0]?.top).toBe(0);
    expect(bands[0]?.bottom).toBeCloseTo(792, 0);
  });

  it("splits around a content block and sorts the gaps tallest first", () => {
    const bands = findFreeBands(page([{ x: 50, y: 100, width: 500, height: 600 }]));
    expect(bands).toHaveLength(2);
    expect(bands[0]?.height).toBeGreaterThan(bands[1]?.height ?? 0);
    // The gaps sit above 100pt and below 700pt, with padding eating a little.
    const tops = bands.map((band) => band.top).sort((a, b) => a - b);
    expect(tops[0]).toBe(0);
    expect(tops[1]).toBeGreaterThanOrEqual(700);
  });

  it("pads content boxes so the notice never crowds real text", () => {
    const withPadding = findFreeBands(page([{ x: 0, y: 400, width: 612, height: 10 }]));
    const upperBand = withPadding.find((band) => band.top === 0);
    expect(upperBand?.bottom).toBeLessThan(400);
  });

  it("drops gaps shorter than the minimum", () => {
    const bands = findFreeBands(
      page([
        { x: 0, y: 0, width: 612, height: 100 },
        { x: 0, y: 104, width: 612, height: 688 },
      ]),
      { minHeightPt: 8, paddingPt: 0 },
    );
    expect(bands).toEqual([]);
  });

  it("returns nothing for a zero-height page instead of looping", () => {
    expect(findFreeBands({ pageIndex: 0, widthPt: 612, heightPt: 0, occupied: [] })).toEqual([]);
  });
});

describe("pickBand", () => {
  const bands = [
    { top: 200, bottom: 500, height: 300 },
    { top: 0, bottom: 60, height: 60 },
    { top: 700, bottom: 780, height: 80 },
  ];

  it("prefers the lowest band that fits for a footer", () => {
    expect(pickBand(bands, 40, "bottom")?.top).toBe(700);
  });

  it("prefers the highest band that fits for margin text", () => {
    expect(pickBand(bands, 40, "top")?.top).toBe(0);
  });

  it("takes the tallest band when asked for the largest", () => {
    expect(pickBand(bands, 40, "largest")?.height).toBe(300);
  });

  it("returns null when nothing fits", () => {
    expect(pickBand(bands, 400, "bottom")).toBeNull();
  });
});

describe("claimBandSpan", () => {
  const bands = [{ top: 0, bottom: 200, height: 200 }];

  it("splits a band around a claim taken from its middle", () => {
    const remaining = claimBandSpan(bands, 90, 110, { gapPt: 0 });
    expect(remaining.map((band) => [band.top, band.bottom])).toEqual([
      [0, 90],
      [110, 200],
    ]);
  });

  it("keeps a gap between the claim and what is left", () => {
    const remaining = claimBandSpan(bands, 90, 110, { gapPt: 5 });
    expect(remaining.find((band) => band.top === 0)?.bottom).toBe(85);
    expect(remaining.find((band) => band.bottom === 200)?.top).toBe(115);
  });

  it("drops a remainder too short to be worth offering", () => {
    const remaining = claimBandSpan(bands, 4, 196, { gapPt: 0, minHeightPt: 8 });
    expect(remaining).toEqual([]);
  });

  it("leaves bands the claim does not touch alone", () => {
    const two = [
      { top: 0, bottom: 50, height: 50 },
      { top: 300, bottom: 400, height: 100 },
    ];
    const remaining = claimBandSpan(two, 310, 390, { gapPt: 0 });
    expect(remaining.some((band) => band.top === 0 && band.bottom === 50)).toBe(true);
  });

  it("returns the remainder tallest first, like findFreeBands", () => {
    const remaining = claimBandSpan(bands, 20, 40, { gapPt: 0 });
    expect(remaining[0]?.height).toBeGreaterThanOrEqual(remaining[1]?.height ?? 0);
  });
});

describe("blockRectInBand", () => {
  it("anchors a footer to the bottom of its band and honours the side margins", () => {
    const rect = blockRectInBand({
      page: page([]),
      band: { top: 700, bottom: 780, height: 80 },
      neededHeightPt: 30,
      marginXPt: 28,
      anchor: "bottom",
    });
    expect(rect.y).toBe(750);
    expect(rect.x).toBe(28);
    expect(rect.width).toBe(556);
    expect(rect.height).toBe(30);
  });

  it("centres by default and never overflows a band it does not fit", () => {
    const rect = blockRectInBand({
      page: page([]),
      band: { top: 100, bottom: 140, height: 40 },
      neededHeightPt: 100,
      marginXPt: 10,
    });
    expect(rect.height).toBe(40);
    expect(rect.y).toBe(100);
  });
});

describe("edgeStripRect", () => {
  it("returns the strip in its pre-rotation frame", () => {
    const rect = edgeStripRect(page([]), 12, "left");
    expect(rect.x).toBe(12);
    expect(rect.y).toBe(792);
    expect(rect.width).toBe(792);
    expect(rect.height).toBe(12);
  });
});

describe("occupiedBoxesFromTextItems", () => {
  it("flips PDF.js baseline coordinates into the top-left convention", () => {
    const boxes = occupiedBoxesFromTextItems(
      [{ transform: [10, 0, 0, 10, 72, 700], width: 120, height: 10 }],
      792,
    );
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.x).toBe(72);
    // Top of the glyph box is 792 - (700 + 10) = 82pt from the page top.
    expect(boxes[0]?.y).toBe(82);
    expect(boxes[0]?.width).toBe(120);
    expect(boxes[0]?.height).toBeCloseTo(12.5, 5);
  });

  it("skips items with no geometry", () => {
    const boxes = occupiedBoxesFromTextItems(
      [
        { transform: [], width: 10, height: 10 },
        { transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0 },
      ],
      792,
    );
    expect(boxes).toEqual([]);
  });
});
